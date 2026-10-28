# Product Requirements Document (PRD): Shared Budget & Goals App

---

## 1. Executive Summary & Vision

Una aplicación multiplataforma enfocada en la planificación financiera proactiva (metodología de sobres y presupuesto base cero) y metas de ahorro compartidas. 

El sistema está diseñado bajo una arquitectura cliente-servidor estricta: **el cliente no almacena datos locales permanentes**; actúa como una capa visual y reactiva conectada en tiempo real a un servidor centralizado desplegado en Docker. Toda la base de código debe construirse bajo la disciplina estricta de **Test-Driven Development (TDD)** para garantizar mantenibilidad, cobertura y refactorización segura.

---

## 2. Technology Stack & Decision Rationale

| Capa | Tecnología | Justificación Técnica |
| :--- | :--- | :--- |
| **Frontend Multiplataforma** | **React Native (Expo SDK 51+) + Expo Router** | Código único para Web, Android e iOS. Ecosistema óptimo para mocking y pruebas unitarias de componentes. |
| **Estilos & UI Kit** | **NativeWind (TailwindCSS v4) + Lucide Icons** | Soporte nativo para modo Claro/Oscuro sin overhead de rendimiento; tokens de diseño estandarizados. |
| **State Management** | **TanStack Query (React Query) + Zustand** | Manejo de caché en memoria del servidor sin persistencia local, sincronización optimista y store global desacoplado. |
| **Backend Runtime** | **Node.js (Fastify) + TypeScript** | Menor latencia y menor consumo de memoria que Express. Soporte integrado para WebSockets y schemas con TypeBox/Zod. |
| **Realtime** | **Fastify WebSocket (@fastify/websocket)** | Permite que las mutaciones de presupuesto o metas impacten en tiempo real a todos los clientes conectados al mismo presupuesto. |
| **Base de Datos & ORM** | **Supabase Hosted PostgreSQL + Prisma ORM** | Tipado estricto extremo a extremo, soporte transaccional ACID. Base de datos gestionada para ahorrar infraestructura local. |
| **Autenticación Externa** | **Supabase Auth / Firebase Auth** | Delega la gestión exclusivamente a Google. El backend solo valida el JWT firmado por el proveedor. |
| **Logging & Observabilidad** | **Pino (Backend) + Sentry (Fullstack)** | `Pino` para logs estructurados ultrarrápidos en formato JSON. `Sentry` para captura de errores, trazas y crashes en producción. |
| **Testing Frameworks** | **Jest / Vitest + React Native Testing Library + Supertest** | Entornos rápidos con soporte TDD para backend (Vitest + Supertest) y frontend (Vitest / RNTL). |
| **Infraestructura** | **Docker + Docker Compose** | Arquitectura contenerizada multi-servicio portable a cualquier VPS o máquina remota. |

---

## 3. Architecture & Infrastructure Topology

La solución desacopla el cliente de la persistencia:

```text
[ Expo Client: Web / Android / iOS ]
                 │
                 ├── (1) OAuth Login ──────────> [ Identity Provider: Google ]
                 │                                         │
                 │ (Bearer JWT)                            │ (Public Keys / JWKS Verification)
                 ▼                                         ▼
[ Reverse Proxy: Caddy / Nginx (SSL Termination + WSS) ]
                 │
                 ├── HTTP/REST (/api/v1/*) ────► [ Fastify Backend Container ]
                 └── WebSocket (/ws) ──────────► [ Fastify WebSocket Server ]
                                                           │
                                                           ▼ (Prisma Transaction Pooler)
                                                 [ Supabase Hosted PostgreSQL ]
```

### Docker Compose Base (`docker-compose.yml`)

```yaml
version: '3.8'

services:
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: budget_api
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: ${SUPABASE_DB_URL}
      PORT: 3000
      SUPABASE_JWT_SECRET: ${SUPABASE_JWT_SECRET}
    networks:
      - internal_network

networks:
  internal_network:
    driver: bridge
```

---

## 4. Database Schema (Prisma ORM)

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  OWNER
  EDITOR          // Acceso de escritura total
  LIMITED_EDITOR  // Lectura/escritura limitada (Por defecto)
  VIEWER          // Solo lectura
}

enum Currency {
  EUR
  USD
  JPY
  CNY
  INR
  GBP
}

enum GoalStatus {
  IN_PROGRESS
  REACHED
  ARCHIVED
}

model User {
  id             String          @id @default(uuid())
  authProviderId String          @unique
  email          String          @unique
  displayName    String?
  avatarUrl      String?
  createdAt      DateTime        @default(now())

  memberships    BudgetMember[]
  contributions  GoalContribution[]
}

model Budget {
  id             String          @id @default(uuid())
  name           String
  currency       Currency        @default(EUR)
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  members        BudgetMember[]
  categories     Category[]
  goals          Goal[]
  invitations    OneTimeInvite[]
}

model BudgetMember {
  id             String          @id @default(uuid())
  userId         String
  budgetId       String
  role           Role            @default(LIMITED_EDITOR)
  joinedAt       DateTime        @default(now())

  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  budget         Budget          @relation(fields: [budgetId], references: [id], onDelete: Cascade)

  @@unique([userId, budgetId])
}

model Category {
  id             String          @id @default(uuid())
  budgetId       String
  name           String
  monthlyLimit   Decimal         @db.Decimal(12, 2)
  icon           String          @default("folder")
  colorHex       String          @default("#64748B")

  budget         Budget          @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  transactions   Transaction[]
}

model Transaction {
  id             String          @id @default(uuid())
  categoryId     String
  amount         Decimal         @db.Decimal(12, 2)
  description    String?
  date           DateTime        @default(now())

  category       Category        @relation(fields: [categoryId], references: [id], onDelete: Cascade)
}

model Goal {
  id             String             @id @default(uuid())
  budgetId       String
  title          String
  targetAmount   Decimal            @db.Decimal(12, 2)
  currentAmount  Decimal            @default(0) @db.Decimal(12, 2)
  deadline       DateTime?
  status         GoalStatus         @default(IN_PROGRESS)
  createdAt      DateTime           @default(now())

  budget         Budget             @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  contributions  GoalContribution[]
}

model GoalContribution {
  id             String          @id @default(uuid())
  goalId         String
  userId         String
  amount         Decimal         @db.Decimal(12, 2)
  date           DateTime        @default(now())

  goal           Goal            @relation(fields: [goalId], references: [id], onDelete: Cascade)
  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model OneTimeInvite {
  id             String          @id @default(uuid())
  budgetId       String
  token          String          @unique @default(uuid())
  role           Role            @default(LIMITED_EDITOR)
  expiresAt      DateTime
  usedAt         DateTime?
  createdAt      DateTime        @default(now())

  budget         Budget          @relation(fields: [budgetId], references: [id], onDelete: Cascade)
}
```

---

## 5. Core Feature Specifications

### 5.1. Authentication (Zero Native Credentials)
- **Flujo:** La app delega el login al SDK de Google. 
- **Verificación:** Al autenticarse, el cliente recibe un `id_token` o JWT que envía en el encabezado `Authorization: Bearer <token>` al backend Fastify.
- **Backend Guard:** El backend verifica la firma del token mediante el `SUPABASE_JWT_SECRET` y sincroniza o crea el registro en la tabla `User`.

### 5.2. Gestión de Roles y Límites de Presupuesto (MÁXIMO 4 MIEMBROS)
- **Límite Estricto:** Cada presupuesto puede tener un **máximo de 4 miembros**. El backend debe rechazar cualquier invitación o intento de unirse si el conteo actual de miembros activos es 4.
- **Jerarquía de Permisos:**
  - `OWNER`: Permiso total. Puede eliminar el presupuesto, gestionar categorías, invitar miembros y cambiar los roles de otros usuarios.
  - `EDITOR`: Acceso total de escritura. Puede crear, editar y eliminar transacciones y categorías, pero no puede eliminar el presupuesto ni cambiar roles.
  - `LIMITED_EDITOR` (Rol por defecto al unirse): Lectura/escritura limitada. Puede añadir transacciones, pero no puede crear/editar categorías ni gestionar miembros.
  - `VIEWER`: Acceso de solo lectura. Solo puede visualizar métricas, saldos y transacciones.

### 5.3. One-Time Use Invite Links (Anti-Intrusos)
- **Generación:** Endpoint `POST /budgets/:id/invites`. Retorna un link `https://app.dominio.com/join?token=<uuid>`.
- **Restricciones:** Expiración de 24 horas.
- **Consumo:** Endpoint `POST /invites/redeem` envuelto en una transacción SQL:
  1. Verificar si el presupuesto ya tiene 4 miembros. Si es así, lanzar error HTTP 403 (Límite alcanzado).
  2. Bloquear registro: `SELECT * FROM "OneTimeInvite" WHERE token = $1 AND "usedAt" IS NULL AND "expiresAt" > NOW() FOR UPDATE`.
  3. Crear `BudgetMember` con rol por defecto `LIMITED_EDITOR`.
  4. Marcar `usedAt` como `NOW()`.

### 5.4. Multi-Currency Engine
- Cada `Budget` tiene asignada una moneda base (`EUR`, `USD`, `JPY`, `CNY`, `INR`, `GBP`).
- Los montos se manejan con tipos `Decimal(12, 2)`. El cliente utiliza `Intl.NumberFormat` parametrizado.

### 5.5. Shared Financial Goals
- Creación de objetivos colaborativos con monto meta y fecha límite opcional.
- Registro atómico de aportes actualizando `currentAmount`. Cambio automático a `REACHED` al completarse.

### 5.6. Realtime Sync via WebSockets
- Conexión autenticada por token: `/ws?token=<jwt>`.
- Suscripción automática a salas aisladas por `budgetId`. Eventos: `TRANSACTION_CREATED`, `GOAL_UPDATED`, etc.

---

## 6. Observabilidad y Logging

- **Backend (Pino):**
  - Todas las peticiones HTTP y eventos de WebSocket se registran en formato estructurado (JSON).
  - Configuración de niveles de log (`info`, `warn`, `error`). Las variables sensibles o tokens de autorización deben ofuscarse en los logs de producción.
- **Fullstack (Sentry):**
  - Integración nativa en Fastify para capturar excepciones no manejadas y rechazos de promesas.
  - Integración en Expo/React Native para capturar crashes de la UI, errores de red y cuellos de botella en el rendimiento (Performance Tracing).

---

## 7. Test-Driven Development (TDD) Methodology

El ciclo **Rojo -> Verde -> Refactorizar** es obligatorio. No se integrará código de producción sin prueba previa.

### 7.1. Casos Críticos de Prueba Obrigatorios (Test Plan)

#### Backend:
- `OneTimeInvite & Member Limits`:
  - **REGLA DE 4 MIEMBROS:** El sistema rechaza un canje válido de invitación si el presupuesto ya tiene 4 miembros (código 403/409).
  - El sistema asigna correctamente `LIMITED_EDITOR` como rol por defecto al canjear el link.
  - Falla con código `410` al intentar canjear el mismo token por segunda vez.
- `Permissions`:
  - Un usuario `LIMITED_EDITOR` recibe error `403` al intentar crear una categoría o expulsar a otro miembro.
  - Un usuario `OWNER` puede actualizar el rol de un `LIMITED_EDITOR` a `EDITOR`.
- `Transactions`:
  - Inserciones con montos negativos son rechazadas (Zod).

#### Frontend:
- `BudgetProgressIndicator` y `CurrencyFormatter` renderizan correctamente.
- La UI oculta los botones de "Crear Categoría" para usuarios con rol `LIMITED_EDITOR` o `VIEWER`.

---

## 8. Phased Implementation Roadmap

### Fase 1: Setup de Infraestructura & TDD Scaffolding
- Inicialización del monorepo / multi-package.
- Configuración de Prisma y conexión a Supabase (Transaction Pooler).
- Setup de Vitest y escritura de los primeros tests (Fase Roja).

### Fase 2: Backend Core & Roles (Red-Green-Refactor)
- **TDD:** Tests de integración para autenticación vía JWT.
- **TDD:** Implementación estricta de la máquina de estados de `OneTimeInvite` y el límite de 4 miembros.
- **TDD:** Middleware de validación de roles (`OWNER`, `EDITOR`, `LIMITED_EDITOR`, `VIEWER`).

### Fase 3: Frontend Base & State Management
- Setup de Expo Router con NativeWind v4.
- Implementación de providers OAuth y conexión WebSocket a TanStack Query.

### Fase 4: Vistas UI & Componentes Adaptativos
- Construcción de vista principal con switch Claro/Oscuro.
- Renderizado condicional de la UI basado en el Rol del usuario activo.
- Pantalla de canje de invitación.

### Fase 5: QA, Pruebas E2E y Observabilidad
- Integración de Sentry en Backend y Frontend.
- Pruebas E2E de flujos compartidos y control de acceso.
- Optimización de Dockerfile para producción.