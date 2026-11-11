import { ApiError, createApiClient } from '@/api/client';

type FetchArgs = [string, RequestInit & { headers: Record<string, string> }];

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function setup({
  token = 'jwt-123' as string | null,
  response = jsonResponse(200, { ok: true }) as Response | (() => Promise<Response>),
  baseUrl = 'https://api.example.com',
} = {}) {
  const fetch = jest.fn((..._args: FetchArgs) =>
    typeof response === 'function' ? response() : Promise.resolve(response.clone()),
  );
  const getToken = jest.fn(async () => token);
  const api = createApiClient({
    baseUrl,
    getToken,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const call = (i = 0) => {
    const [url, init] = fetch.mock.calls[i]!;
    return { url, init, headers: init.headers };
  };
  return { api, fetch, getToken, call };
}

describe('cliente HTTP de la API', () => {
  it('GET a /api/v1 con la query (sin los parámetros undefined) y devuelve el JSON', async () => {
    const { api, call } = setup({ response: jsonResponse(200, { items: [], nextCursor: null }) });

    const data = await api.get<{ items: unknown[]; nextCursor: string | null }>(
      '/budgets/b1/transactions',
      { query: { limit: 20, cursor: undefined, isRecurring: true } },
    );

    expect(data).toEqual({ items: [], nextCursor: null });
    expect(call().url).toBe(
      'https://api.example.com/api/v1/budgets/b1/transactions?limit=20&isRecurring=true',
    );
    expect(call().init.method).toBe('GET');
  });

  it('admite la URL base con barra final', async () => {
    const { api, call } = setup({ baseUrl: 'https://api.example.com/' });

    await api.get('/me');

    expect(call().url).toBe('https://api.example.com/api/v1/me');
  });

  it('envía el JWT como Bearer, pidiéndolo en cada petición (puede haberse renovado)', async () => {
    const { api, getToken, call } = setup();

    await api.get('/me');
    await api.get('/me');

    expect(call().headers.authorization).toBe('Bearer jwt-123');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('sin sesión no envía Authorization', async () => {
    const { api, call } = setup({ token: null });

    await api.get('/me');

    expect(call().headers).not.toHaveProperty('authorization');
  });

  it('POST envía el cuerpo en JSON con su Content-Type; un GET no lleva Content-Type', async () => {
    const { api, call } = setup({ response: jsonResponse(201, { id: 't1' }) });

    await api.get('/me');
    const created = await api.post('/budgets/b1/transactions', { amount: '12.50' });

    expect(call(0).headers).not.toHaveProperty('content-type');
    expect(call(1).init.method).toBe('POST');
    expect(call(1).headers['content-type']).toBe('application/json');
    expect(call(1).init.body).toBe(JSON.stringify({ amount: '12.50' }));
    expect(created).toEqual({ id: 't1' });
  });

  it.each(['patch', 'put', 'delete'] as const)('%s usa su método HTTP', async (method) => {
    const { api, call } = setup({ response: new Response(null, { status: 204 }) });

    await api[method]('/budgets/b1');

    expect(call().init.method).toBe(method.toUpperCase());
  });

  it('una respuesta 204 devuelve undefined', async () => {
    const { api } = setup({ response: new Response(null, { status: 204 }) });

    await expect(api.delete('/budgets/b1/transactions/t1')).resolves.toBeUndefined();
  });

  it('un error de la API llega como ApiError con su estado, código, mensaje e id de petición', async () => {
    const { api } = setup({
      response: jsonResponse(
        409,
        { error: { code: 'CONFLICT', message: 'Ya eres miembro de este presupuesto' } },
        { 'x-request-id': 'req-42' },
      ),
    });

    const error = await api.post('/invitations/x/accept').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Ya eres miembro de este presupuesto',
      requestId: 'req-42',
    });
  });

  it('una respuesta de error que no es de la API (502 del proxy) es HTTP_ERROR', async () => {
    const { api } = setup({
      response: new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    });

    await expect(api.get('/me')).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
      message: 'Error del servidor (502)',
      requestId: null,
    });
  });

  it('sin conexión es NETWORK_ERROR con estado 0', async () => {
    const { api } = setup({
      response: () => Promise.reject(new TypeError('Network request failed')),
    });

    await expect(api.get('/me')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'No se pudo conectar con el servidor',
    });
  });

  it('una cancelación (AbortError de TanStack Query) se propaga tal cual, no como fallo', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    const { api, call } = setup({ response: () => Promise.reject(abort) });

    await expect(api.get('/me', { signal: controller.signal })).rejects.toBe(abort);
    expect(call().init.signal).toBe(controller.signal);
  });
});
