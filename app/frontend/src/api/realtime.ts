import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { queryKeys } from '@/api/query-keys';

/** Cierres que define el backend (`realtime.routes.ts` y `hub.ts`). */
const CLOSE_NORMAL = 1000;
const CLOSE_TOKEN_EXPIRED = 4401;
const CLOSE_ACCOUNT_DELETED = 4403;
const CLOSE_RATE_LIMITED = 4429;

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const RATE_LIMITED_DELAY_MS = 30_000;

type Entity = 'budget' | 'member' | 'category' | 'transaction' | 'goal';

/** Por qué se deja de recibir un presupuesto: lo que manda el servidor, o `NOT_FOUND` al suscribirse. */
export type BudgetLostReason = 'REMOVED' | 'LEFT' | 'BUDGET_DELETED' | 'NOT_FOUND';

interface WebSocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export interface RealtimeClientOptions {
  baseUrl: string;
  /** Se pide en cada conexión: tras un 4401 llega uno renovado. `null` sin sesión. */
  getToken: () => Promise<string | null>;
  queryClient: QueryClient;
  WebSocket?: { new (url: string, protocols: string[]): WebSocketLike; readonly OPEN: number };
  /** Expulsado, salió, presupuesto borrado o ya no es miembro: la pantalla debe salir de él. */
  onBudgetLost?: (budgetId: string, reason: BudgetLostReason) => void;
  /** La cuenta se ha borrado: no tiene sentido reconectar. */
  onAccountDeleted?: () => void;
}

export interface RealtimeClient {
  connect(): void;
  disconnect(): void;
  subscribe(budgetId: string): void;
  unsubscribe(budgetId: string): void;
}

/** Qué hay que volver a pedir tras un cambio de cada entidad (además de la actividad). */
function keysAffectedBy(entity: Entity, budgetId: string): QueryKey[] {
  const budget = queryKeys.budgets;
  switch (entity) {
    case 'transaction':
    case 'category':
      // Las transacciones cambian el gasto de las categorías y del resumen, y las listas de
      // transacciones muestran el nombre de su categoría.
      return [budget.transactions(budgetId), budget.summary(budgetId), budget.categories(budgetId)];
    case 'goal':
      return [budget.goals(budgetId)];
    case 'member':
      // También `/me`: puede haber cambiado el rol del propio usuario.
      return [budget.members(budgetId), queryKeys.me()];
    case 'budget':
      return [budget.detail(budgetId)];
  }
}

const ENTITIES = new Set<string>(['budget', 'member', 'category', 'transaction', 'goal']);
const CHANGES = new Set<string>(['created', 'updated', 'deleted']);

/**
 * Cliente del WebSocket de la API. Los eventos no traen datos, solo qué ha cambiado: se invalida
 * la caché de TanStack Query y las pantallas vuelven a pedirlo con sus permisos.
 */
export function createRealtimeClient({
  baseUrl,
  getToken,
  queryClient,
  WebSocket: Socket = globalThis.WebSocket as unknown as NonNullable<
    RealtimeClientOptions['WebSocket']
  >,
  onBudgetLost,
  onAccountDeleted,
}: RealtimeClientOptions): RealtimeClient {
  const url = `${baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/api/v1/ws`;
  const subscriptions = new Set<string>();
  let socket: WebSocketLike | null = null;
  let stopped = true;
  let connecting = false;
  let hasConnected = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const isOpen = () => socket !== null && socket.readyState === Socket.OPEN;
  const send = (message: object) => {
    if (isOpen()) socket?.send(JSON.stringify(message));
  };
  const invalidate = (queryKey: QueryKey, exact = false) => {
    void queryClient.invalidateQueries({ queryKey, exact });
  };
  /** La lista de presupuestos y `/me`, sin arrastrar el contenido de cada presupuesto. */
  const invalidateMemberships = () => {
    invalidate(queryKeys.budgets.all(), true);
    invalidate(queryKeys.me(), true);
  };

  function loseBudget(budgetId: string, reason: BudgetLostReason) {
    subscriptions.delete(budgetId);
    // Ya no tiene permiso para verlo: sus datos no deben quedarse en pantalla.
    queryClient.removeQueries({ queryKey: queryKeys.budgets.detail(budgetId) });
    invalidateMemberships();
    onBudgetLost?.(budgetId, reason);
  }

  function handleMessage(data: unknown) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }
    const { type, budgetId, entity, reason, code } = message;
    if (typeof budgetId !== 'string') return;

    if (typeof type === 'string' && CHANGES.has(type)) {
      if (typeof entity !== 'string' || !ENTITIES.has(entity)) return;
      for (const key of keysAffectedBy(entity as Entity, budgetId)) invalidate(key);
      invalidate(queryKeys.budgets.activity(budgetId));
      if (entity === 'budget') invalidateMemberships();
      return;
    }
    // Sin `reason` es la respuesta a un `unsubscribe` propio.
    if (type === 'unsubscribed' && typeof reason === 'string') {
      loseBudget(budgetId, reason as BudgetLostReason);
    } else if (type === 'error' && code === 'NOT_FOUND') {
      loseBudget(budgetId, 'NOT_FOUND');
    }
  }

  function scheduleReconnect(code: number) {
    let delay: number;
    if (code === CLOSE_TOKEN_EXPIRED) delay = 0;
    else if (code === CLOSE_RATE_LIMITED) delay = RATE_LIMITED_DELAY_MS;
    else {
      delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      attempt += 1;
    }
    timer = setTimeout(() => {
      timer = null;
      void open();
    }, delay);
  }

  async function open() {
    if (stopped || socket || connecting) return;
    connecting = true;
    const token = await getToken().catch(() => null);
    connecting = false;
    if (stopped || !token) return;

    const ws = new Socket(url, ['bearer', token]);
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      for (const budgetId of subscriptions) send({ type: 'subscribe', budgetId });
      // Mientras estuvo caída se perdieron eventos: lo suscrito puede estar desactualizado.
      if (hasConnected) {
        for (const budgetId of subscriptions) invalidate(queryKeys.budgets.detail(budgetId));
        invalidateMemberships();
      }
      hasConnected = true;
    };
    ws.onmessage = (event) => handleMessage(event.data);
    ws.onerror = () => {
      // El cierre llega después por `onclose`, que decide si reconectar.
    };
    ws.onclose = ({ code }) => {
      if (socket === ws) socket = null;
      if (stopped) return;
      if (code === CLOSE_ACCOUNT_DELETED) {
        stopped = true;
        onAccountDeleted?.();
        return;
      }
      scheduleReconnect(code);
    };
  }

  return {
    connect() {
      stopped = false;
      void open();
    },
    disconnect() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      socket?.close(CLOSE_NORMAL);
      socket = null;
    },
    subscribe(budgetId) {
      if (subscriptions.has(budgetId)) return;
      subscriptions.add(budgetId);
      send({ type: 'subscribe', budgetId });
    },
    unsubscribe(budgetId) {
      if (!subscriptions.delete(budgetId)) return;
      send({ type: 'unsubscribe', budgetId });
    },
  };
}
