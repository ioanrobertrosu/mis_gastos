# TODO — Mis Gastos (`mis_gastos`)

Checklist maestro de desarrollo. Fuente de verdad funcional: [PRD.md](PRD.md). Reglas obligatorias: [rules/index.md](rules/index.md) y [ONBOARDING.md](ONBOARDING.md).

## Cómo usar este archivo

- Marca cada tarea con `[x]` **en el mismo commit** en que se completa.
- Las fases están ordenadas por dependencia: no empieces una fase sin cerrar (o descartar explícitamente) la anterior.
- Toda lógica de negocio sigue el ciclo TDD ([rules/tdd-and-workflow.md](rules/tdd-and-workflow.md)):
  - 🔴 **Rojo** — escribir el test que falla. **Pausa obligatoria**: el usuario valida el rojo antes de seguir.
  - 🟢 **Verde** — código mínimo de producción para pasarlo.
  - 🔵 **Refactor** — limpiar sin cambiar comportamiento (tests en verde).
- Las tareas marcadas con ❓ son decisiones que hay que tomar antes de implementar lo que depende de ellas. Anota la decisión debajo de la tarea al cerrarla.

---

## Fase 0 — Saneamiento y decisiones previas

### 0.1 Configuración del repositorio
- [x] Corregir `.gitignore`: sustituir `.*` por entradas explícitas (`.env`, `.env.*.local`, `oauth/`, `node_modules/`, `dist/`, `coverage/`, `.expo/`) para no ignorar `.env.example`, `.agents/`, `.claude/`, `.github/`, `.dockerignore`
- [x] Verificar que `.env` y `oauth/*.plist` siguen fuera del control de versiones tras el cambio
- [ ] Versionar `.env.example`, `.agents/skills/` y `.claude/skills/` (si procede)
- [ ] Corregir enlaces rotos de [rules/index.md](rules/index.md) (`rules/rules/...` → rutas relativas)
- [ ] Actualizar `README.md` con nombre temporal, stack y enlaces a PRD / ONBOARDING / TODO

### 0.2 Variables de entorno
- [ ] Unificar nombres entre `.env`, `.env.example`, `docker-compose.yml` y PRD (`DATABASE_URL`/`DIRECT_URL` vs `SUPABASE_DATABASE_URL`/`SUPABASE_DIRECT_URL`)
- [ ] Añadir a `.env.example`: `JWT_ISSUER`, `JWT_AUDIENCE`, `SUPABASE_CALLBACK_SIGNIN_URL`
- [ ] Añadir `?pgbouncer=true` (y `connection_limit` adecuado) a la URL del transaction pooler para Prisma
- [ ] Separar variables de backend y de cliente (las del cliente con prefijo `EXPO_PUBLIC_`; los `CLIENT_SECRET` nunca en el cliente)

### 0.3 Docker Compose
- [x] Pasar al servicio `api` todas las variables necesarias (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `PORT`, `NODE_ENV`)
  - **Nota:** se cargan con `env_file: ./app/backend/.env` (fuente única); `NODE_ENV`, `HOST` y `PORT` se fijan en `environment`. Los valores con `$` deben ir entre comillas simples en `.env` para que Compose no los interpole.
- [x] Separar entornos: `docker-compose.yml` (prod) + `docker-compose.override.yml` (dev con volumen `./app/backend/src` y `npm run dev`)
- [x] Eliminar la clave obsoleta `version: '3.8'`
- [x] Añadir `healthcheck` del servicio apuntando a `GET /health`

### 0.4 Decisiones de diseño (❓)
- [x] ❓ Validación: **TypeBox** (nativo Fastify) o **Zod** → elegir una y documentarla en [rules/backend-and-db.md](rules/backend-and-db.md)
  - **Decisión:** TypeBox (`@sinclair/typebox` + `@fastify/type-provider-typebox`).
- [x] ❓ Verificación de JWT de Supabase: secreto HS256 (`SUPABASE_JWT_SECRET`) o claves asimétricas vía JWKS (proyectos nuevos de Supabase)
  - **Decisión:** secreto HS256 (`SUPABASE_JWT_SECRET`) por ahora. Encapsular la verificación en un único plugin para facilitar la migración futura a JWKS (ver Fase 8).
- [x] ❓ Relación `User.id` ↔ `auth.users.id` de Supabase (reutilizar el `sub` del JWT como `User.id` o mapear vía `Identity`)
  - **Decisión:** `User.id = sub` del JWT. `Identity` queda como registro informativo de los proveedores vinculados (Google, Apple…).
- [x] ❓ Testing en frontend: Vitest + RNTL (soporte limitado en RN) o `jest-expo` + RNTL solo para el cliente
  - **Decisión:** `jest-expo` + RNTL en el frontend; Vitest se mantiene en el backend.
- [x] ❓ Estructura de repo: carpetas independientes (`app/backend`, `app/frontend`) o monorepo con workspaces y paquete compartido de tipos
  - **Decisión:** carpetas independientes `app/backend` y `app/frontend` (sin workspaces); el backend se despliega dockerizado en un servidor propio. Expo Router crea su propia carpeta de rutas, por lo que quedará `app/frontend/app/`.
- [x] ❓ Versión de NativeWind compatible con Tailwind v4 y con el SDK de Expo elegido
  - **Decisión:** usar la versión de NativeWind compatible con Tailwind v4 (v5). Verificar su estabilidad y el SDK de Expo compatible al iniciar la Fase 9.
- [ ] Reflejar la decisión de testing del frontend en la tabla de stack del [PRD.md](PRD.md) (fila *Testing*)

### 0.5 Correcciones al esquema del PRD
- [x] `User.id` sin `@default(uuid())`: se asigna explícitamente con el `sub` del JWT
- [ ] `ActivityLog.userId` → `String?` (con `onDelete: SetNull` el campo debe ser opcional)
- [ ] Añadir `Transaction.createdById` (+ relación con `User`) para la regla de LIMITED_EDITOR
- [ ] Añadir tipo de transacción (`EXPENSE` / `INCOME`) o documentar la convención de signo del `amount`
- [ ] Añadir a `User` un marcador de borrado lógico (`deletedAt`) y anonimizar también `email` (es `@unique`)
- [ ] Añadir `createdAt` a `Transaction` (distinto de `date`, necesario para cursores estables)
- [ ] Añadir índices sobre FKs sin indexar (`BudgetMember.budgetId`, `Category.budgetId`, `Goal.budgetId`, `GoalContribution.goalId`, `Identity.userId`)
- [ ] Índice compuesto para paginación: `Transaction(categoryId, date DESC, id)` y `ActivityLog(budgetId, createdAt DESC, id)`
- [x] Revisar `OneTimeInvite`: `@@index([token])` es redundante con `@unique`; añadir `createdById`
- [ ] Reflejar todos los cambios en la sección 4 del [PRD.md](PRD.md)

---

## Fase 1 — Cimientos del backend (secuencia de [ONBOARDING.md](ONBOARDING.md))

### 1.1 Inicialización
- [x] Crear `app/backend` e inicializar `package.json` (`name: mis_gastos-backend`, `type: module`)
- [x] Instalar Fastify + TypeScript + `tsx`; configurar `tsconfig.json` en modo `strict`
- [x] Definir scripts: `dev`, `build`, `start`, `test`, `test:watch`, `test:coverage`, `lint`, `typecheck`
- [x] Configurar ESLint + Prettier
- [x] Estructura base: `src/app.ts` (factory `buildApp()`), `src/server.ts` (arranque), `src/config/`, `src/modules/`, `src/plugins/`

### 1.2 Base de datos
- [x] Instalar Prisma y `@prisma/client`; `prisma init`
- [x] Configurar `datasource` con `DATABASE_URL` y `directUrl = DIRECT_URL`
  - **Nota:** Prisma 7 ya no admite `url`/`directUrl` en `schema.prisma`. `prisma.config.ts` usa `DIRECT_URL` (CLI/migraciones) y el cliente en runtime usará `DATABASE_URL` vía `@prisma/adapter-pg`. Generador `prisma-client` con salida en `src/generated/prisma`.
- [x] Trasladar **solo** el modelo `User` a `schema.prisma`
- [x] Ejecutar la primera migración contra Supabase (`prisma migrate dev`)
- [x] Crear singleton del cliente Prisma como plugin de Fastify (`fastify.prisma`) con cierre en `onClose`

### 1.3 Testing — primer ciclo TDD
- [x] Instalar y configurar Vitest (`vitest.config.ts`, cobertura con `v8`)
- [x] 🔴 Test: `buildApp()` arranca y `GET /health` responde `200 { status: "ok" }` (vía `app.inject`)
- [x] ⏸️ Pausa: el usuario valida el estado Rojo
- [x] 🟢 Implementar `buildApp()` y la ruta `/health`
- [x] 🔴 Test: `/health` informa `db: "up"` cuando Prisma responde a `SELECT 1`
- [x] 🟢 Implementar la comprobación de BD en `/health`
- [x] 🔵 Refactor

### 1.4 Configuración y entorno
- [x] 🔴 Test: el cargador de configuración falla de forma explícita si falta una variable obligatoria
- [x] 🟢 Implementar `src/config/env.ts` validado con el esquema elegido
- [x] Configurar una BD de test aislada (schema separado o proyecto Supabase de test) y `setup` de Vitest que limpie datos entre tests
  - **Decisión (actualizada):** Postgres 17 local en Docker (`docker-compose.test.yml`, en memoria, puerto `127.0.0.1:54329`), que arranca el `globalSetup`; suite completa de ~10 min a ~1,5 min. Para usar otra BD, definir `TEST_DATABASE_URL` y `TEST_DIRECT_URL`. Antes: proyecto Supabase de test independiente. Vitest separa los proyectos `unit` e `integration` (`*.int.test.ts`); la integración aplica `prisma migrate deploy`, trunca las tablas antes de cada test y ejecuta los ficheros en serie.

### 1.5 Contenedorización
- [x] Crear `app/backend/Dockerfile` multi-stage (deps → build → runtime con `node:lts-alpine`, usuario no root)
- [x] Crear `app/backend/.dockerignore`
- [x] Actualizar `build.context` de `docker-compose.yml` a `./app/backend`
- [x] Ejecutar `prisma generate` dentro de la imagen
- [x] Verificar `docker compose up` y `GET /health` desde el host

### 1.6 Base transversal de la API
- [x] Prefijo global de rutas `/api/v1`
- [x] 🔴 Test: el manejador de errores devuelve un formato uniforme `{ error: { code, message } }` y no filtra stack traces en producción
- [x] 🟢 Implementar `setErrorHandler` y errores de dominio tipados (`NotFound`, `Forbidden`, `Conflict`, `LimitExceeded`)
- [x] 🔴 Test: un parámetro `:id` que no es UUID devuelve `400` sin llegar a Prisma
- [x] 🟢 Implementar un esquema reutilizable de parámetros UUID
- [x] Logger Pino configurado (JSON en prod, `pino-pretty` en dev, redacción de `authorization`)
- [x] CORS y `@fastify/helmet` configurados
- [x] `@fastify/rate-limit` en rutas públicas y de invitación
  - **Nota:** registrado con `global: false`; cada ruta pública o de invitación lo activa con `config.rateLimit` al crearse (Fase 3).

---

## Fase 2 — Autenticación y usuarios

### 2.1 Validación de JWT
- [x] 🔴 Test: una petición sin `Authorization` a una ruta protegida devuelve `401`
- [x] 🔴 Test: un JWT con firma, `iss`, `aud` o `exp` inválidos devuelve `401`
- [x] 🔴 Test: un JWT válido expone `request.user` con `sub` y `email`
- [x] 🟢 Implementar el plugin `authenticate` (decorador `preHandler`)
  - **Nota:** `jose` (`jwtVerify`, solo HS256, `iss`/`aud`/`exp`/`sub` obligatorios). `auth` es opción obligatoria de `buildApp` y el plugin se registra antes que cualquier ruta (un `preHandler` indefinido dejaría la ruta pública sin avisar).
- [x] Crear un helper de tests para firmar JWT de prueba

### 2.2 Sincronización de usuario
- [x] Añadir el modelo `Identity` al esquema y migrar
- [x] 🔴 Test: el primer acceso con un JWT nuevo crea `User` con `id = sub` + `Identity` (provider leído de `app_metadata.provider`)
- [x] 🔴 Test: accesos posteriores reutilizan el mismo `User` (idempotente, sin duplicados)
- [x] 🟢 Implementar el upsert de usuario en el hook de autenticación
  - **Nota:** `syncUser` sin transacción, con pasos idempotentes (`createMany` + `skipDuplicates`): camino habitual = 1 lectura de `Identity`. Usuario nuevo sin email → 403; email de otro usuario → 409. `providerId` = `user_metadata.provider_id` o el `sub`; `provider` = `app_metadata.provider` o `email`.
- [x] 🔵 Refactor

### 2.3 Perfil
- [x] 🔴 Test: `GET /api/v1/me` devuelve el perfil y las membresías
- [x] 🔴 Test: `PATCH /api/v1/me` actualiza `displayName`/`avatarUrl` y rechaza campos no permitidos
- [x] 🟢 Implementar las rutas `/me`
  - **Nota:** `memberships` (completado tras la Fase 3): `{ budgetId, budgetName, currency, role, joinedAt }` por orden de incorporación; el detalle de cada presupuesto está en `GET /budgets`.

---

## Fase 3 — Presupuestos, miembros, roles e invitaciones

### 3.1 Esquema
- [x] Añadir `Budget`, `BudgetMember`, `OneTimeInvite` y enums `Role` / `Currency`; migrar

### 3.2 CRUD de presupuestos
- [x] 🔴 Test: `POST /budgets` crea el presupuesto y asigna al creador como `OWNER` (en una transacción)
- [x] 🔴 Test: un usuario con 3 presupuestos (propios o compartidos) recibe `409/422` al crear el 4.º
- [x] 🔴 Test: `GET /budgets` lista solo los presupuestos del usuario
- [x] 🔴 Test: `GET /budgets/:id` devuelve `404` si el usuario no es miembro (no revelar existencia)
- [x] 🟢 Implementar las rutas de lectura y creación de presupuestos
  - **Nota:** límite de 3 → `422 LIMIT_EXCEEDED`. La creación bloquea la fila del `User` (`SELECT … FOR UPDATE`) dentro de la transacción para serializar creaciones simultáneas; el test de concurrencia falla si se quita el bloqueo.
- [x] 🔴 Test: solo OWNER puede `PATCH` (nombre, divisa) y `DELETE` del presupuesto
- [x] 🟢 Implementar la actualización y el borrado

### 3.3 Autorización por rol
- [x] 🔴 Tests de la matriz de permisos (OWNER / EDITOR / LIMITED_EDITOR / VIEWER × acción)
- [x] 🟢 Implementar `requireRole(budgetId, roles[])` como `preHandler` reutilizable
  - **Nota:** implementado como `app.requirePermission(action)` sobre la matriz de `modules/budgets/permissions.ts` (acciones en vez de listas de roles). Lee `:id`, deja `request.membership`; 404 si no es miembro, 403 si el rol no basta. VIEWER puede exportar; las contribuciones a metas se añadirán a la matriz en la Fase 5.
- [x] 🔵 Refactor: centralizar la matriz de permisos en un único módulo

### 3.4 Invitaciones
- [x] 🔴 Test: OWNER genera una invitación de un solo uso con rol y `expiresAt`
- [x] 🔴 Test: aceptar una invitación válida crea `BudgetMember` y la marca `isUsed`
- [x] 🔴 Test: una invitación caducada o usada devuelve error
- [x] 🔴 Test: no se puede aceptar si el presupuesto ya tiene 4 miembros
- [x] 🔴 Test: no se puede aceptar si el usuario ya tiene 3 presupuestos
- [x] 🔴 Test: aceptar dos veces en concurrencia solo crea una membresía (bloqueo / `UPDATE ... WHERE isUsed = false`)
- [x] 🟢 Implementar la creación, aceptación y revocación de invitaciones
  - **Nota:** usada/caducada → `410` (`INVITATION_USED` / `INVITATION_EXPIRED`); no se puede invitar como OWNER; caducidad 1–168 h (48 h por defecto); el límite de 4 miembros se comprueba al aceptar. Aceptación en una transacción con bloqueos invitación → presupuesto → usuario y `LOCKING_TRANSACTION` (maxWait 10 s, timeout 15 s). Ruta de aceptación con rate limit (10/min por IP).

### 3.5 Gestión de miembros
- [x] 🔴 Test: OWNER cambia el rol de un miembro (no puede degradarse a sí mismo sin transferir)
- [x] 🔴 Test: OWNER expulsa a un miembro
- [x] 🔴 Test: un miembro no OWNER puede abandonar el presupuesto
- [x] 🟢 Implementar las rutas de miembros

### 3.6 Transferencia de propiedad y offboarding
- [x] 🔴 Test: OWNER no puede abandonar sin transferir la propiedad antes
- [x] 🔴 Test: la transferencia manual de propiedad intercambia los roles de forma atómica
- [x] 🟢 Implementar la transferencia de propiedad
  - **Nota:** `POST /budgets/:id/ownership { userId }`: intercambia los roles (el antiguo OWNER asume el rol del destinatario). Transferencia, cambio de rol, expulsión y abandono bloquean la fila del `Budget` y revalidan el rol del solicitante bajo el bloqueo, de modo que siempre queda exactamente un OWNER.
- [x] 🔴 Test: al borrar la cuenta, el OWNER pasa al miembro con `joinedAt` más antiguo
- [x] 🔴 Test: al borrar la cuenta siendo el único miembro, el presupuesto se elimina en cascada
- [x] 🔴 Test: el borrado de usuario anonimiza (`displayName = "Usuario Eliminado"`) y preserva transacciones y contribuciones
  - **Nota:** cubierto en `delete-me.int.test.ts` (transacciones en la Fase 4, contribuciones en la 5). Pasan desde el principio: el soft delete conserva la fila del usuario y nada borra sus movimientos; son tests de regresión.
- [x] 🟢 Implementar `DELETE /me` con el fallback de propiedad y el soft delete
  - **Nota:** `User.deletedAt`; la fila queda anonimizada (`displayName = "Usuario Eliminado"`, avatar nulo, email `deleted-<id>@deleted.invalid` para liberar el original) y se borran sus identidades. `syncUser` responde 401 a una cuenta borrada y nunca la reactiva. Una transacción con bloqueos presupuestos (ordenados) → usuario.
- [x] Revocar la sesión / eliminar el usuario en Supabase Auth tras el borrado
  - **Nota:** `AuthAdmin` inyectable en `buildApp` (por defecto no hace nada; los tests nunca llaman a Supabase). En producción, `DELETE {SUPABASE_URL}/auth/v1/admin/users/:id` con `SUPABASE_SERVICE_ROLE_KEY` en `apikey` + `Bearer`; 404 cuenta como éxito. Se llama tras confirmar el borrado local; si falla, se registra el error y la respuesta sigue siendo 204 (la cuenta ya está anonimizada y su token recibe 401).

---

## Fase 4 — Categorías y transacciones

### 4.1 Categorías
- [x] Añadir el modelo `Category` y migrar
- [x] 🔴 Test: OWNER crea una categoría con `monthlyLimit`, `icon` y `colorHex` validados (hex válido, límite ≥ 0)
- [x] 🔴 Test: roles distintos de OWNER no pueden crear, editar ni borrar categorías
- [x] 🔴 Test: el borrado es soft delete (`isActive = false`) y las inactivas no se listan por defecto
- [x] 🟢 Implementar el CRUD de categorías
  - **Nota:** importes como texto (`MoneySchema` en `shared/money.ts`: hasta 10 cifras enteras y 2 decimales, sin números JSON) y siempre devueltos con 2 decimales. `PATCH` solo acepta `isActive: true` (reactivar); desactivar es `DELETE` (soft delete idempotente). Una categoría de otro presupuesto → 404 "Categoría no encontrada".
- [x] 🔴 Test: el listado incluye el gasto acumulado del mes actual y el porcentaje consumido
- [x] 🟢 Implementar la agregación mensual por categoría
  - **Nota:** `GET /budgets/:id/categories?month=YYYY-MM` (por defecto el mes actual UTC) añade `spent` (texto, 2 decimales, suma en la BD) y `percentUsed` (1 decimal, mitad hacia arriba; `null` con límite 0; puede superar 100). Rango del mes en `shared/month.ts`.

### 4.2 Transacciones
- [x] Añadir el modelo `Transaction` (con `createdById` y tipo) y migrar
  - **Decisión:** sin campo de tipo: solo gastos (modelo base cero; el asignado son los límites de las categorías). Los ingresos podrán añadirse más adelante sin romper nada. `budgetId` redundante para listar/agregar sin join; `date` es `@db.Date` (`YYYY-MM-DD`).
- [x] 🔴 Test: OWNER/EDITOR/LIMITED_EDITOR pueden crear transacciones; VIEWER recibe `403`
- [x] 🔴 Test: LIMITED_EDITOR solo edita/borra sus propias transacciones
- [x] 🔴 Test: no se puede crear una transacción en una categoría inactiva o de otro presupuesto
- [x] 🔴 Test: los importes se validan como decimales con 2 decimales como máximo (sin floats)
- [x] 🟢 Implementar el CRUD de transacciones
  - **Nota:** importe > 0 (`PositiveMoneySchema`); fecha `YYYY-MM-DD`. Categoría de otro presupuesto/inexistente → 404, inactiva → 409 (al crear y al moverla; una transacción ya existente en una categoría desactivada sigue siendo editable). LIMITED_EDITOR solo modifica las suyas (`transaction:edit-any` decide), tampoco las de autor borrado.
- [x] 🔴 Test: paginación por cursor (`limit` 20 por defecto, `nextCursor`, orden estable `date DESC, id DESC`)
- [x] 🔴 Test: filtros por categoría y rango de fechas
- [x] 🟢 Implementar el listado paginado
  - **Nota:** `GET /budgets/:id/transactions` → `{ items, nextCursor }`. Cursor keyset opaco (base64url de `[date, id]`), robusto ante borrados/altas entre páginas; `limit` 1–100 (20 por defecto); filtros `categoryId`, `from`, `to` (inclusivos). Cursor ilegible o `from > to` → 400 `VALIDATION_ERROR`.
- [x] ❓ Definir el comportamiento de `isRecurring` (plantilla + generación mensual o solo marca informativa)
  - **Decisión:** solo marca informativa. Las transacciones recurrentes se registran a mano cada mes, porque el importe real puede diferir del previsto (ej. 400 € presupuestados → 300 € pagados).
- [x] 🔴 Test: `isRecurring` se acepta al crear/editar y el listado permite filtrar por él
- [x] 🟢 Implementar el campo y el filtro `isRecurring`

### 4.3 Resumen del presupuesto
- [x] 🔴 Test: `GET /budgets/:id/summary?month=YYYY-MM` devuelve el asignado, el gastado y el restante (base cero)
- [x] 🟢 Implementar el resumen
  - **Nota:** `{ month, currency, allocated, spent, remaining, percentUsed }`. Asignado = límites de las categorías activas; gastado = todo el gasto del mes (también en categorías desactivadas después); restante puede ser negativo. Sumas en la BD (NUMERIC).

---

## Fase 5 — Metas de ahorro

- [x] Añadir `Goal`, `GoalContribution` y el enum `GoalStatus`; migrar
  - **Nota:** `GoalContribution.userId` opcional con `SetNull` (como el autor de las transacciones) en lugar del `Cascade` del PRD: un borrado físico de usuario no debe descuadrar `currentAmount`. `deadline` es `@db.Date`.
- [x] 🔴 Test: OWNER/EDITOR crean, editan y borran metas; LIMITED_EDITOR y VIEWER no
- [x] 🟢 Implementar el CRUD de metas
  - **Nota:** `status` y `currentAmount` no se editan: el estado se deriva (`REACHED` si lo ahorrado ≥ objetivo) y `archived: true/false` archiva/desarchiva recalculándolo. La edición bloquea la fila de la meta (`FOR UPDATE`) para no competir con las contribuciones. Fechas compartidas en `shared/date.ts`.
- [x] 🔴 Test: una contribución incrementa `currentAmount` de forma atómica (`increment` en transacción)
- [x] 🔴 Test: contribuciones concurrentes no pierden actualizaciones
- [x] 🔴 Test: al alcanzar `targetAmount` el estado pasa a `REACHED`
- [x] 🔴 Test: no se admiten contribuciones a metas `ARCHIVED`
- [x] 🟢 Implementar las contribuciones
  - **Nota:** `POST /budgets/:id/goals/:goalId/contributions { amount }` → `{ contribution, goal }`. Nueva acción `goal:contribute` (OWNER/EDITOR/LIMITED_EDITOR). Una transacción con bloqueo de la meta: `increment` + recálculo del estado; `ARCHIVED` → 409; una meta `REACHED` sigue admitiendo aportaciones. Sin el bloqueo, falla el test de archivar mientras se aporta (el estado se sobrescribía).
- [x] 🔴 Test: listado de contribuciones por meta con autor (anonimizado si el usuario fue borrado)
- [x] 🟢 Implementar el listado
  - **Nota:** `GET /budgets/:id/goals/:goalId/contributions` → más recientes primero, con `author { id, displayName, avatarUrl }` (o `null` si no hay autor). Sin paginación: las aportaciones por meta son acotadas. La anonimización viene de `DELETE /me`.

---

## Fase 6 — Actividad, alertas y exportación

### 6.1 ActivityLog
- [x] Añadir el modelo `ActivityLog` y migrar
  - **Nota:** `userId` (autor) opcional con `SetNull`; índice `(budgetId, createdAt DESC, id DESC)` para el muro.
- [x] Definir el catálogo de acciones como enum/constantes (`MEMBER_JOINED`, `CATEGORY_LIMIT_UPDATED`, `GOAL_REACHED`, `TRANSACTION_CREATED`, …)
  - **Decisión:** enum `ActivityAction` en la BD (21 acciones de presupuesto, miembros, categorías, transacciones y metas). Las alertas de la 6.2 se añadirán al enum allí.
- [x] 🔴 Test: cada mutación relevante registra su actividad dentro de la misma transacción de BD
- [x] 🟢 Implementar el servicio `logActivity` e integrarlo en los módulos existentes
  - **Nota:** `modules/activity/activity.service.ts` (`logActivity(tx, …)` + `changesBetween`). Cada mutación registra dentro de su transacción (las que no tenían, ahora la tienen); sin cambios reales o con la petición rechazada no se registra nada. Columna `seq` (autoincremental) para ordenar: varias entradas de una transacción comparten `createdAt`. Sin invitaciones creadas/revocadas en el muro (solo `MEMBER_JOINED`).
- [x] 🔴 Test: `GET /budgets/:id/activity` paginado por cursor
- [x] 🟢 Implementar el muro de actividad
  - **Nota:** `GET /budgets/:id/activity` → `{ items, nextCursor }`, más reciente primero; cursor keyset opaco sobre `seq`; `limit` 1–100 (20). Cada entrada con `actor` (perfil público, anonimizado si borró la cuenta, o `null`). Sin filtro por acción por ahora.

### 6.2 Alertas inteligentes
- [x] 🔴 Test: se genera la alerta `CATEGORY_90_PERCENT` al superar el 90 % del límite (una sola vez por mes y categoría)
- [x] 🔴 Test: alerta al exceder el 100 %, al alcanzar una meta y al unirse un miembro
- [x] 🟢 Implementar la detección de hitos
  - **Nota:** las alertas son entradas del muro (`CATEGORY_90_PERCENT`, `CATEGORY_LIMIT_EXCEEDED`; la meta alcanzada y el nuevo miembro ya eran `GOAL_REACHED` y `MEMBER_JOINED`). 90 % = gasto ≥ 90 % en decimal exacto; exceso = estrictamente > 100 %; un salto directo por encima del límite solo genera la de exceso. `dedupeKey` único (acción + categoría + mes). Se evalúan al crear o editar una transacción (categoría y mes de destino) y al bajar un límite (solo el mes actual UTC). Bloqueo `FOR NO KEY UPDATE` de la categoría: sin él se pierde la alerta; con `FOR UPDATE` hay interbloqueo (ambos comprobados).

### 6.3 Exportación CSV
- [x] 🔴 Test: `GET /api/v1/budgets/:id/export?from&to` devuelve `text/csv` con cabeceras y filas correctas
- [x] 🔴 Test: el CSV escapa comas, comillas y saltos de línea; protege contra inyección de fórmulas (`=`, `+`, `-`, `@`)
- [x] 🔴 Test: solo los miembros del presupuesto pueden exportar; rango de fechas obligatorio y validado
- [x] 🟢 Implementar la exportación en streaming
  - **Nota:** generador asíncrono con lotes de 500 (keyset `date ASC, id ASC`) sobre `Readable.from`. CSV RFC 4180 con coma y CRLF, BOM UTF-8 para Excel. Columnas `fecha,categoria,importe,descripcion,recurrente,autor`; autor = `displayName` o email. El texto libre que empieza por `=`, `+`, `-`, `@`, tabulador o CR lleva un `'` delante.

---

## Fase 7 — Tiempo real (WebSocket)

- [x] Instalar `@fastify/websocket`
- [x] 🔴 Test: la conexión WSS sin JWT válido se rechaza
- [x] 🔴 Test: el cliente solo puede suscribirse a presupuestos de los que es miembro
- [x] 🟢 Implementar la autenticación del handshake y las salas por `budgetId`
  - **Nota:** `GET /api/v1/ws`. JWT en `Authorization` (móvil) o `new WebSocket(url, ['bearer', token])` para navegadores (se negocia solo `bearer`; la cabecera tiene prioridad); nunca en la URL, y `Sec-WebSocket-Protocol` redactado en los logs. Cierre 4401 al caducar el token; mensajes de más de 4 KB → 1009. `subscribe`/`unsubscribe`; no miembro o inexistente → `NOT_FOUND`. Salas en memoria (`RealtimeHub`): una sola instancia del backend.
- [x] 🔴 Test: tras una mutación, los demás clientes del presupuesto reciben un evento ligero `{ type, budgetId, entity, id }` (sin payload completo)
- [x] 🟢 Implementar el emisor de eventos de dominio → broadcast
  - **Nota:** `RealtimeHub.publish`, llamado desde cada ruta tras resolverse el servicio (ya confirmado; si la mutación falla, no hay evento). Eventos `{ type: created|updated|deleted, budgetId, entity: budget|member|category|transaction|goal, id }`, sin datos. Una aportación es `updated` de la meta. Llegan a todas las conexiones suscritas, también a las del autor.
- [x] 🔴 Test: un miembro expulsado deja de recibir eventos inmediatamente
- [x] 🟢 Implementar la desuscripción al perder la membresía
  - **Nota:** expulsión/abandono/presupuesto borrado → `{ type: "unsubscribed", budgetId, reason: REMOVED|LEFT|BUDGET_DELETED }` (la conexión sigue abierta para sus otros presupuestos). Cuenta borrada → cierre 4403 de todas sus conexiones. El expulsado sale de la sala antes de publicar su baja. `subscribe` comprueba la membresía, entra en la sala y vuelve a comprobarla, para cubrir una expulsión simultánea.
- [ ] Heartbeat ping/pong y limpieza de conexiones muertas

---

## Fase 8 — Observabilidad y endurecimiento del backend

- [ ] Integrar Sentry en el backend (`@sentry/node`) con release y entorno
- [x] Migrar la verificación de JWT de HS256 a claves asimétricas vía JWKS
  - [x] 🟢 `jwks` en `AuthOptions`; en `server.ts`, `createRemoteJWKSet({JWT_ISSUER}/.well-known/jwks.json)`. La clave se elige por algoritmo (HS256 → secreto; ES256/RS256 → JWKS). Comprobado: el JWKS del proyecto publica la clave ES256 en standby.
  - [x] 🔴 Test: se aceptan tokens ES256/RS256 de claves publicadas en el JWKS y siguen valiendo los HS256 heredados; se rechazan claves/kid desconocidas, issuer/audience incorrectos y la confusión de algoritmo; un fallo del JWKS da 401
  - **Nota:** adelantado de la Fase 8: el proyecto Supabase ya tiene la nueva clave en standby y no debe rotarse hasta que el backend la verifique.
- [ ] Añadir `requestId` / correlación en los logs de Pino
- [ ] Documentación OpenAPI (`@fastify/swagger` + UI solo en dev)
- [ ] Umbral mínimo de cobertura en Vitest (p. ej. 80 %) y que falle el CI si no se alcanza
- [ ] Revisión de seguridad: rate limits, tamaño máximo de body, cabeceras, secretos fuera de los logs
- [ ] Revisar consultas N+1 y planes `EXPLAIN` de los listados paginados
- [ ] Pipeline de CI (GitHub Actions): lint → typecheck → test → build de la imagen Docker
- [ ] Definir el destino de despliegue del contenedor en producción

---

## Fase 9 — Cimientos del frontend (Expo)

> Bloqueada por ONBOARDING hasta nuevo aviso. Requiere cerrar las decisiones ❓ de la Fase 0.

### 9.1 Proyecto
- [ ] Crear la app Expo con Expo Router (`app/frontend`, slug `mis_gastos`, nombre visible "Mis Gastos")
- [ ] Configurar TypeScript estricto, ESLint y alias de imports
- [ ] Definir la estructura de carpetas (skill `expo-project-structure`)
- [ ] Configurar el runner de tests elegido + RNTL

### 9.2 Design system
- [ ] Instalar y configurar NativeWind + Tailwind v4
- [ ] Definir tokens: escala de grises, esmeralda, ámbar y carmesí; espaciado, radios y tipografía
- [ ] Modo oscuro con `dark:` y preferencia System / Dark / Light (persistida solo como preferencia de UI)
- [ ] Componentes base: `Screen` (con `SafeAreaView`), `Button`, `Text`, `Card`, `MoneyInput` (`keyboardType="decimal-pad"`), `Amount` (con soporte de blur)
- [ ] Iconos con `lucide-react-native`
- [ ] Wrapper de haptics (`expo-haptics`)

### 9.3 Datos y estado
- [ ] Cliente HTTP tipado que inyecta el JWT de Supabase
- [ ] `QueryClientProvider` y convención de `queryKeys`
- [ ] Store de Zustand solo para UI efímera (modo blur, filtros, modales)
- [ ] Cliente WebSocket con reconexión que dispara `invalidateQueries`

### 9.4 Autenticación
- [ ] Integrar `@supabase/supabase-js` con almacenamiento seguro de sesión (`expo-secure-store`)
- [ ] Login con Google OAuth (Web, Android, iOS) usando los client IDs de `.env`
- [ ] Configurar deep links / scheme y la URL de callback en Supabase
- [ ] Guardas de rutas autenticadas en Expo Router

---

## Fase 10 — Funcionalidades del frontend

- [ ] Pantalla de onboarding / login
- [ ] Selector de presupuestos (máx. 3) y creación de presupuesto
- [ ] Dashboard del presupuesto: resumen mensual y barras por categoría con colores semánticos
- [ ] Gestión de categorías (solo OWNER)
- [ ] Lista de transacciones con infinite scroll (`useInfiniteQuery`) y filtros
- [ ] Formulario de transacción con teclado decimal y haptics al confirmar
- [ ] Metas: listado, detalle, contribuciones y celebración (haptics) al alcanzarlas
- [ ] Muro de actividad paginado y destacado de alertas
- [ ] Invitaciones: generar/compartir enlace y aceptar vía deep link
- [ ] Gestión de miembros y roles (solo OWNER) y transferencia de propiedad
- [ ] Modo blur global de importes
- [ ] Ajustes de cuenta: `displayName`, avatar, tema, identidades vinculadas, borrar cuenta
- [ ] Ajustes del presupuesto: divisa (solo OWNER) y exportación CSV
- [ ] Actualizaciones optimistas en las mutaciones clave
- [ ] Estados de carga, vacío y error en todas las pantallas
- [ ] Integrar Sentry en el cliente (`@sentry/react-native`)
- [ ] Auditoría de accesibilidad y UI (skill `web-design-guidelines` en web)

---

## Fase 11 — Empaquetado y distribución (EAS)

- [ ] `eas init` y vinculación del proyecto
- [ ] Crear `eas.json` con los perfiles `development`, `preview` y `production`
- [ ] Variables de entorno por perfil (backend/Supabase de test vs producción)
- [ ] Generar el SHA-1 con `eas credentials` y registrarlo en el OAuth client de Android
- [ ] Build de Development Client
- [ ] Build `.apk` (preview) para testing interno
- [ ] Build Simulator de iOS
- [ ] Build `.aab` firmado para Google Play
- [ ] Build `.ipa` firmado para TestFlight (requiere Apple Developer Program)
- [ ] Build y despliegue de la versión web
- [ ] Automatizar las builds de producción desde CI
