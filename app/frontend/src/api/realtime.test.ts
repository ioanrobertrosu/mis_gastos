import { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/query-keys';
import { createRealtimeClient, type RealtimeClientOptions } from '@/api/realtime';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** WebSocket falso: registra lo enviado y deja simular la apertura, mensajes y cierres. */
class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }

  // Simulación del servidor.
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const latest = () => FakeWebSocket.instances.at(-1)!;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let queryClient: QueryClient;

function setup(overrides: Partial<RealtimeClientOptions> = {}) {
  const getToken = jest.fn(async (): Promise<string | null> => 'jwt-1');
  const onBudgetLost = jest.fn();
  const onAccountDeleted = jest.fn();
  const client = createRealtimeClient({
    baseUrl: 'https://api.example.com/',
    getToken,
    queryClient,
    WebSocket: FakeWebSocket as unknown as RealtimeClientOptions['WebSocket'],
    onBudgetLost,
    onAccountDeleted,
    ...overrides,
  });
  return { client, getToken, onBudgetLost, onAccountDeleted };
}

/** Siembra datos en la caché para comprobar qué invalida cada evento. */
function seed() {
  const keys = {
    transactions: queryKeys.budgets.transactions(A, { categoryId: 'c1' }),
    summary: queryKeys.budgets.summary(A, '2026-11'),
    categories: queryKeys.budgets.categories(A, { month: '2026-11' }),
    goals: queryKeys.budgets.goals(A),
    contributions: queryKeys.budgets.contributions(A, 'g1'),
    members: queryKeys.budgets.members(A),
    activity: queryKeys.budgets.activity(A),
    detail: queryKeys.budgets.detail(A),
    all: queryKeys.budgets.all(),
    me: queryKeys.me(),
    otherBudget: queryKeys.budgets.transactions(B),
  };
  for (const key of Object.values(keys)) queryClient.setQueryData(key, 'dato');
  return keys;
}

function invalidatedNames(keys: Record<string, readonly unknown[]>) {
  return Object.entries(keys)
    .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
    .sort();
}

async function connected(overrides: Partial<RealtimeClientOptions> = {}) {
  const ctx = setup(overrides);
  ctx.client.connect();
  await flush();
  latest().open();
  return ctx;
}

beforeEach(() => {
  jest.useFakeTimers();
  FakeWebSocket.instances = [];
  queryClient = new QueryClient();
});

afterEach(() => {
  queryClient.clear();
  jest.useRealTimers();
});

describe('cliente WebSocket', () => {
  describe('conexión', () => {
    it('conecta a wss://…/api/v1/ws con el JWT como subprotocolo (nunca en la URL)', async () => {
      await connected();

      expect(latest().url).toBe('wss://api.example.com/api/v1/ws');
      expect(latest().protocols).toEqual(['bearer', 'jwt-1']);
    });

    it('sin sesión no conecta', async () => {
      const { client } = setup({ getToken: async () => null });

      client.connect();
      await flush();

      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('se suscribe a los presupuestos pedidos, también a los pedidos antes de abrir', async () => {
      const { client } = setup();
      client.subscribe(A);
      client.connect();
      await flush();
      latest().open();
      client.subscribe(B);

      expect(latest().sent).toEqual([
        { type: 'subscribe', budgetId: A },
        { type: 'subscribe', budgetId: B },
      ]);
    });

    it('unsubscribe avisa al servidor y deja de reenviarlo al reconectar', async () => {
      const { client } = await connected();
      client.subscribe(A);
      client.subscribe(B);
      client.unsubscribe(A);
      latest().drop(1006);
      await jest.advanceTimersByTimeAsync(1_000);
      latest().open();

      expect(FakeWebSocket.instances[0]!.sent).toContainEqual({
        type: 'unsubscribe',
        budgetId: A,
      });
      expect(latest().sent).toEqual([{ type: 'subscribe', budgetId: B }]);
    });
  });

  describe('invalidación por evento', () => {
    it.each([
      ['transaction', ['activity', 'categories', 'summary', 'transactions']],
      ['category', ['activity', 'categories', 'summary', 'transactions']],
      ['goal', ['activity', 'contributions', 'goals']],
      ['member', ['activity', 'me', 'members']],
    ])('un cambio de %s invalida solo lo que afecta', async (entity, expected) => {
      const { client } = await connected();
      client.subscribe(A);
      const keys = seed();

      latest().receive({ type: 'created', budgetId: A, entity, id: 'x1' });

      expect(invalidatedNames(keys)).toEqual(expected);
    });

    it('un cambio del presupuesto invalida todo el presupuesto, la lista y /me', async () => {
      const { client } = await connected();
      client.subscribe(A);
      const keys = seed();

      latest().receive({ type: 'updated', budgetId: A, entity: 'budget', id: A });

      expect(invalidatedNames(keys)).toEqual(
        Object.keys(keys)
          .filter((name) => name !== 'otherBudget')
          .sort(),
      );
    });

    it('ignora mensajes ilegibles o desconocidos sin romper', async () => {
      await connected();
      const keys = seed();

      latest().onmessage?.({ data: 'no es json' });
      latest().receive({ type: 'created', budgetId: A, entity: 'desconocida', id: 'x' });
      latest().receive({ type: 'subscribed', budgetId: A });

      expect(invalidatedNames(keys)).toEqual([]);
    });
  });

  describe('perder el acceso a un presupuesto', () => {
    const cases: [string, object, string][] = [
      ['expulsado', { type: 'unsubscribed', budgetId: A, reason: 'REMOVED' }, 'REMOVED'],
      [
        'presupuesto borrado',
        { type: 'unsubscribed', budgetId: A, reason: 'BUDGET_DELETED' },
        'BUDGET_DELETED',
      ],
      ['ya no es miembro', { type: 'error', code: 'NOT_FOUND', budgetId: A }, 'NOT_FOUND'],
    ];

    it.each(cases)(
      '%s: borra sus datos de la caché, refresca /me y la lista y avisa',
      async (_case, message, reason) => {
        const { client, onBudgetLost } = await connected();
        client.subscribe(A);
        const keys = seed();

        latest().receive(message);

        expect(queryClient.getQueryData(keys.transactions)).toBeUndefined();
        expect(queryClient.getQueryData(keys.detail)).toBeUndefined();
        expect(queryClient.getQueryData(keys.otherBudget)).toBe('dato');
        expect(invalidatedNames(keys)).toEqual(['all', 'me']);
        expect(onBudgetLost).toHaveBeenCalledWith(A, reason);
      },
    );

    it('un presupuesto perdido no se vuelve a suscribir al reconectar', async () => {
      const { client } = await connected();
      client.subscribe(A);
      client.subscribe(B);
      latest().receive({ type: 'unsubscribed', budgetId: A, reason: 'LEFT' });
      latest().drop(1006);
      await jest.advanceTimersByTimeAsync(1_000);
      latest().open();

      expect(latest().sent).toEqual([{ type: 'subscribe', budgetId: B }]);
    });
  });

  describe('reconexión', () => {
    it('tras una caída reconecta con espera creciente (1, 2, 4 s) y la reinicia al conectar', async () => {
      await connected();

      latest().drop(1006);
      await jest.advanceTimersByTimeAsync(999);
      expect(FakeWebSocket.instances).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(2);

      latest().drop(1006);
      await jest.advanceTimersByTimeAsync(1_999);
      expect(FakeWebSocket.instances).toHaveLength(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(3);

      latest().drop(1006);
      await jest.advanceTimersByTimeAsync(4_000);
      expect(FakeWebSocket.instances).toHaveLength(4);

      latest().open();
      latest().drop(1006);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(FakeWebSocket.instances).toHaveLength(5);
    });

    it('la espera no pasa de 30 s', async () => {
      await connected();

      for (let i = 0; i < 10; i++) {
        latest().drop(1006);
        await jest.advanceTimersByTimeAsync(30_000);
      }

      expect(FakeWebSocket.instances).toHaveLength(11);
    });

    it('al reconectar se resuscribe e invalida sus presupuestos (se perdió lo ocurrido)', async () => {
      const { client } = await connected();
      client.subscribe(A);
      const keys = seed();

      latest().drop(1006);
      await jest.advanceTimersByTimeAsync(1_000);
      latest().open();

      expect(latest().sent).toEqual([{ type: 'subscribe', budgetId: A }]);
      expect(invalidatedNames(keys)).toEqual([
        'activity',
        'all',
        'categories',
        'contributions',
        'detail',
        'goals',
        'me',
        'members',
        'summary',
        'transactions',
      ]);
    });

    it('token caducado (4401): reconecta enseguida con un token nuevo', async () => {
      const { getToken } = await connected();
      getToken.mockResolvedValue('jwt-2');

      latest().drop(4401);
      await jest.advanceTimersByTimeAsync(0);

      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(latest().protocols).toEqual(['bearer', 'jwt-2']);
    });

    it('límite superado (4429): espera 30 s antes de reconectar', async () => {
      await connected();

      latest().drop(4429);
      await jest.advanceTimersByTimeAsync(29_999);
      expect(FakeWebSocket.instances).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('cuenta borrada (4403): no reconecta y avisa', async () => {
      const { onAccountDeleted } = await connected();

      latest().drop(4403);
      await jest.advanceTimersByTimeAsync(60_000);

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(onAccountDeleted).toHaveBeenCalledTimes(1);
    });

    it('disconnect cierra la conexión y no reconecta', async () => {
      const { client } = await connected();

      client.disconnect();
      latest().drop(1000);
      await jest.advanceTimersByTimeAsync(60_000);

      expect(FakeWebSocket.instances[0]!.closedWith).toBe(1000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('disconnect durante la espera cancela la reconexión pendiente', async () => {
      const { client } = await connected();

      latest().drop(1006);
      client.disconnect();
      await jest.advanceTimersByTimeAsync(60_000);

      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });
});
