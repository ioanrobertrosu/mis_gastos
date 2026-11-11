import { fetch as expoFetch } from 'expo/fetch';

const API_PREFIX = '/api/v1';

/** Error de una petición a la API. `status` 0 es que no hubo respuesta (sin conexión). */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** `x-request-id` de la respuesta: el mismo id que en los logs del servidor y en Sentry. */
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Se pide en cada petición: la sesión puede haber renovado el JWT. `null` sin sesión. */
  getToken: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}

export type ApiClient = ReturnType<typeof createApiClient>;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Error uniforme de la API: `{ error: { code, message } }`. */
function apiErrorBody(body: unknown): { code: string; message: string } | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body as { error: unknown };
  if (typeof error !== 'object' || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : null;
}

export function createApiClient({
  baseUrl,
  getToken,
  fetch = expoFetch as unknown as typeof globalThis.fetch,
}: ApiClientOptions) {
  const root = `${baseUrl.replace(/\/+$/, '')}${API_PREFIX}`;

  function urlFor(path: string, query: RequestOptions['query']): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.append(key, String(value));
    }
    const search = params.toString();
    return `${root}${path}${search ? `?${search}` : ''}`;
  }

  async function request<T>(
    method: string,
    path: string,
    body: unknown,
    { query, signal }: RequestOptions = {},
  ): Promise<T> {
    const token = await getToken();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(urlFor(path, query), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      // Una cancelación no es un fallo: TanStack Query la reconoce por su nombre.
      if (isAbortError(error)) throw error;
      throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor', null);
    }

    const requestId = response.headers.get('x-request-id');
    if (!response.ok) {
      const parsed = apiErrorBody(await response.json().catch(() => null));
      throw parsed
        ? new ApiError(response.status, parsed.code, parsed.message, requestId)
        : new ApiError(
            response.status,
            'HTTP_ERROR',
            `Error del servidor (${response.status})`,
            requestId,
          );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    get: <T = unknown>(path: string, options?: RequestOptions) =>
      request<T>('GET', path, undefined, options),
    post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>('POST', path, body, options),
    patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>('PATCH', path, body, options),
    put: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>('PUT', path, body, options),
    delete: <T = unknown>(path: string, options?: RequestOptions) =>
      request<T>('DELETE', path, undefined, options),
  };
}
