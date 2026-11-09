# Mis Gastos

> Nombre provisional del proyecto (`mis_gastos`).

App multiplataforma (iOS, Android y web) para planificar los gastos del mes, solo o con otras personas: presupuesto base cero por categorías, metas de ahorro compartidas y cambios en tiempo real para todos los miembros de un presupuesto.

## Estado

| Parte | Estado |
| ----- | ------ |
| Backend (API REST + WebSocket) | Funcional y desplegado (fases 1–8 de [TODO.md](TODO.md)) |
| Frontend (Expo) | Pendiente: bloqueado hasta cerrar el backend ([ONBOARDING.md](ONBOARDING.md)) |

## Stack

- **Backend:** Node.js 22, Fastify 5, TypeScript, TypeBox, Prisma 7 sobre Supabase PostgreSQL, WebSocket nativo de Fastify.
- **Auth:** Supabase Auth; la API verifica los JWT (JWKS y secreto heredado).
- **Tests:** Vitest con TDD estricto; los de integración usan un Postgres efímero en Docker.
- **Operación:** Docker Compose, Caddy (TLS automático), Sentry para errores y CI en GitHub Actions.
- **Frontend (previsto):** React Native con Expo Router, NativeWind, TanStack Query y Zustand. Sin persistencia relacional en el cliente.

## Estructura

```
app/backend/      API: código (src/), tests (test/), esquema y migraciones de Prisma (prisma/)
rules/            Reglas de desarrollo (TDD, UI, estado, backend)
docker-compose*.yml   Producción, desarrollo (override) y BD de test
.github/workflows/    CI del backend
```

## Desarrollo local

Requisitos: Node.js 22 y Docker.

```bash
cd app/backend
npm ci
cp .env.example .env      # y completa las variables de Supabase Auth
npm run dev:db:up         # Postgres de desarrollo en 127.0.0.1:54328
npx prisma migrate deploy
npm run dev               # http://localhost:3000, documentación en /docs
```

La base de datos de desarrollo es local: nunca la de producción.

### Tests

```bash
npm test                  # unitarios + integración (arranca solo la BD de test)
npm run test:coverage     # con el umbral de cobertura que exige el CI
npm run lint && npm run typecheck
```

## Documentación

- [PRD.md](PRD.md): requisitos funcionales, arquitectura y modelo de datos.
- [ONBOARDING.md](ONBOARDING.md): directrices de trabajo y fase actual.
- [TODO.md](TODO.md): checklist por fases, con las decisiones tomadas.
- [rules/index.md](rules/index.md): reglas de desarrollo.
- Referencia de la API: OpenAPI en `/docs` con el servidor de desarrollo en marcha.

## Licencia

[MIT](LICENSE)
