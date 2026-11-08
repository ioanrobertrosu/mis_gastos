import type * as Sentry from '@sentry/node';

/** Contexto de la petición que falló. Solo identificadores: ni email, ni token, ni query. */
export interface ErrorContext {
  requestId: string;
  method: string;
  /** Patrón de la ruta (`/budgets/:id`), no la URL. */
  route: string | undefined;
  userId: string | undefined;
}

/** Notifica los errores inesperados (500). Inyectable: los tests no envían nada a Sentry. */
export interface ErrorReporter {
  captureException(error: unknown, context: ErrorContext): void;
}

export const NOOP_ERROR_REPORTER: ErrorReporter = { captureException: () => {} };

/** Lo que se usa del SDK; en los tests se sustituye por uno falso. */
export type SentryClient = Pick<typeof Sentry, 'init' | 'captureException'>;

export interface ErrorReporterOptions {
  /** Sin DSN no se inicializa Sentry (desarrollo, tests). */
  dsn?: string | undefined;
  environment: string;
  release: string;
}

// Cabeceras que llevan credenciales: el JWT (también en el subprotocolo del WebSocket) y cookies.
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'sec-websocket-protocol'];

/**
 * Qué recoge el SDK. Sus valores por defecto lo recogen todo (cabeceras, cookies, query y
 * cuerpos, que aquí son datos financieros): se limita a cabeceras sin credenciales.
 */
export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { deny: SENSITIVE_HEADERS }, response: false },
  httpBodies: [],
  urlQueryParams: false,
} as const satisfies NonNullable<Sentry.NodeOptions['dataCollection']>;

/**
 * Integraciones por defecto que se quitan. `Fastify` captura los errores por su cuenta, sin las
 * etiquetas ni el usuario, y la deduplicación descarta entonces la notificación del error handler.
 * Las variables locales enviarían los valores en memoria (tokens, importes).
 */
const EXCLUDED_INTEGRATIONS = new Set(['Fastify', 'LocalVariables', 'LocalVariablesAsync']);

/** `beforeSend`, por si algo escapa a `DATA_COLLECTION`: quita credenciales, cookies y query. */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (!event.request) return event;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cookies, query_string, headers, ...request } = event.request;
  return {
    ...event,
    request: {
      ...request,
      ...(headers && {
        headers: Object.fromEntries(
          Object.entries(headers).filter(
            ([name]) => !SENSITIVE_HEADERS.includes(name.toLowerCase()),
          ),
        ),
      }),
    },
  };
}

export function createErrorReporter(
  { dsn, environment, release }: ErrorReporterOptions,
  sentry: SentryClient,
): ErrorReporter {
  if (!dsn) return NOOP_ERROR_REPORTER;

  sentry.init({
    dsn,
    environment,
    release,
    dataCollection: DATA_COLLECTION,
    // Solo errores: el rendimiento ya se ve en los logs (responseTime) y las trazas cuestan cuota.
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    integrations: (defaults) => defaults.filter(({ name }) => !EXCLUDED_INTEGRATIONS.has(name)),
  });

  return {
    captureException(error, { requestId, method, route, userId }) {
      sentry.captureException(error, {
        tags: { requestId, method, route: route ?? 'desconocida' },
        ...(userId === undefined ? {} : { user: { id: userId } }),
      });
    },
  };
}
