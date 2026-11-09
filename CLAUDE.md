# CLAUDE.md — Mis Gastos (`mis_gastos`)

Índice de los documentos que guían el desarrollo. Léelos antes de actuar; ante cualquier conflicto, el orden de prioridad es: `ONBOARDING.md` → `rules/` → `PRD.md`.

## Documentos principales

| Archivo | Contenido | Cuándo leerlo |
| ----- | ----- | ----- |
| [PRD.md](PRD.md) | Fuente de verdad funcional: stack, arquitectura, esquema Prisma, reglas de negocio, UI/UX, CI/CD | Antes de cualquier tarea |
| [ONBOARDING.md](ONBOARDING.md) | Directrices innegociables para la IA, enfoque actual (Fase 9: frontend) y secuencia de acción inicial | Al empezar cada sesión |
| [TODO.md](TODO.md) | Checklist maestro por fases, con decisiones de diseño (❓) ya tomadas | Para saber qué toca hacer; marcar `[x]` al completar |
| [README.md](README.md) | Presentación general del proyecto | Contexto básico |

## Reglas (`rules/`)

Punto de entrada: [rules/index.md](rules/index.md)

1. [rules/tdd-and-workflow.md](rules/tdd-and-workflow.md) — Metodología: TDD estricto (Rojo → Verde → Refactor) y flujo de trabajo
2. [rules/ui-and-styling.md](rules/ui-and-styling.md) — Interfaz y estilos (NativeWind, paleta, modo oscuro)
3. [rules/native-interactions.md](rules/native-interactions.md) — Interacciones nativas (safe areas, teclado numérico, haptics)
4. [rules/state-management.md](rules/state-management.md) — Estado y datos (TanStack Query, Zustand)
5. [rules/backend-and-db.md](rules/backend-and-db.md) — Backend y base de datos (Fastify, Prisma, Supabase)

## Infraestructura y configuración

- [docker-compose.yml](docker-compose.yml) — Contenedorización del backend
- [.env.example](.env.example) — Variables de entorno esperadas (nunca versionar `.env`)

## Skills disponibles

Skills del proyecto para Expo, Supabase, Vitest, etc. (`expo-router`, `expo-design-system`, `supabase`, `vitest`, …). Invócalas cuando la tarea las requiera.

## Resumen de restricciones clave

- Stack: Node.js + Fastify + Prisma + Supabase (backend); Expo SDK 58 + Expo Router (frontend, en `app/frontend`).
- TDD obligatorio: nunca escribir código de producción sin un test previo que falle; pausar tras la fase Roja para que el usuario la valide.
- Prohibida cualquier persistencia local relacional en el cliente.
- Fase actual: Fase 9, cimientos del frontend (ver [ONBOARDING.md](ONBOARDING.md)). El backend está en producción.
- Al completar una tarea, marcarla en [TODO.md](TODO.md) en el mismo commit.
