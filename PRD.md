# Product Requirements Document (PRD): Shared Budget & Goals App

## 1. Executive Summary & Vision

Una aplicación multiplataforma enfocada en la planificación financiera proactiva (metodología de presupuesto base cero y sistema de sobres) orientada a la gestión familiar o grupal.

El sistema está diseñado bajo una **arquitectura cliente-servidor estricta**: el cliente (móvil/web) no almacena datos relacionales locales de forma permanente; actúa como una capa visual y reactiva conectada en tiempo real a un servidor centralizado (contenedorizado en Docker). La aplicación se centra en la concurrencia, permitiendo a múltiples usuarios interactuar con el mismo presupuesto sin conflictos.

Toda la base de código debe construirse bajo la disciplina estricta de **Test-Driven Development (TDD)**, garantizando una cobertura de pruebas desde el primer commit.

## 2. Technology Stack & Decision Rationale

| Capa | Tecnología | Justificación Técnica | 
| ----- | ----- | ----- | 
| **Frontend** | **React Native (Expo SDK 51+) + Expo Router** | Código único para Web, Android e iOS. Enrutamiento basado en archivos (file-based routing) ideal para deep links. | 
| **Estilos & UI** | **NativeWind (TailwindCSS v4) + Lucide Icons** | Soporte nativo para modo Claro/Oscuro sin overhead; tokens de diseño estandarizados. | 
| **Estado Cliente** | **TanStack Query + Zustand** | Manejo de caché en memoria (Infinite Scroll/Cursores), sincronización optimista y estado global (UI) desacoplado. | 
| **Backend API** | **Node.js (Fastify) + TypeScript** | Menor latencia y consumo de memoria que Express. Ecosistema de validación ultrarrápido con TypeBox/Zod. | 
| **Realtime** | **Fastify WebSocket** | Las mutaciones impactan en tiempo real a todos los clientes conectados al mismo budget. | 
| **Base de Datos** | **Supabase Hosted PostgreSQL + Prisma ORM** | Tipado estricto extremo a extremo, soporte transaccional ACID, índices B-Tree para consultas rápidas. | 
| **Auth** | **Supabase Auth (Delegada)** | Autenticación basada en JWT (OAuth de Google preconfigurado). Soporte futuro multi-proveedor. | 
| **Testing** | **Vitest + RNTL + Supertest** | Entorno de ejecución rápido para soporte TDD estricto. | 

## 3. Architecture & Infrastructure

### 3.1. Diagrama de Arquitectura (Client-Server Estricto)

```
sequenceDiagram
    participant Mobile as Expo Client (React Native)
    participant Auth as Supabase Auth (Google OAuth)
    participant API as Fastify Backend (Docker)
    participant DB as Supabase PostgreSQL

    Mobile->>Auth: 1. Login via Google OAuth
    Auth-->>Mobile: 2. Return JWT & Session
    Mobile->>API: 3. REST/WSS requests with JWT (Bearer)
    API->>API: 4. Validate JWT (Issuer/Audience/Secret)
    API->>DB: 5. Prisma Queries (Transaction Pooler)
    DB-->>API: 6. Return Data
    API-->>Mobile: 7. JSON Response / WSS Event

```

### 3.2. Docker Compose (Backend Containerization)

El servidor backend debe ejecutarse en un entorno Dockerizado para garantizar paridad entre desarrollo y producción.

```
version: '3.8'
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - PORT=3000
      - DATABASE_URL=${DATABASE_URL}
      - DIRECT_URL=${DIRECT_URL}
      - SUPABASE_JWT_SECRET=${SUPABASE_JWT_SECRET}
      - JWT_ISSUER=${JWT_ISSUER}
      - JWT_AUDIENCE=authenticated
    volumes:
      - ./src:/app/src
    command: npm run dev

```

## 4. Database Schema (Prisma ORM)

Diseño normalizado con atomización de identidades, índices de rendimiento y UUIDs por seguridad.

```
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
  EDITOR
  LIMITED_EDITOR
  VIEWER
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
  email          String          @unique
  displayName    String?
  avatarUrl      String?
  createdAt      DateTime        @default(now())

  identities     Identity[]
  memberships    BudgetMember[]
  contributions  GoalContribution[]
  activities     ActivityLog[]
}

model Identity {
  id             String          @id @default(uuid())
  userId         String
  provider       String          // e.g., "google", "apple"
  providerId     String
  createdAt      DateTime        @default(now())
  
  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerId])
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
  activities     ActivityLog[]
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

model OneTimeInvite {
  id             String          @id @default(uuid())
  budgetId       String
  token          String          @unique @default(uuid())
  role           Role            @default(LIMITED_EDITOR)
  expiresAt      DateTime
  isUsed         Boolean         @default(false)
  createdAt      DateTime        @default(now())

  budget         Budget          @relation(fields: [budgetId], references: [id], onDelete: Cascade)

  @@index([token])
}

model Category {
  id             String          @id @default(uuid())
  budgetId       String
  name           String
  monthlyLimit   Decimal         @db.Decimal(12, 2)
  icon           String          @default("folder")
  colorHex       String          @default("#64748B")
  isActive       Boolean         @default(true) // Soft delete

  budget         Budget          @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  transactions   Transaction[]
}

model Transaction {
  id             String          @id @default(uuid())
  categoryId     String
  amount         Decimal         @db.Decimal(12, 2)
  description    String?
  date           DateTime        @default(now())
  isRecurring    Boolean         @default(false)

  category       Category        @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@index([categoryId])
  @@index([date])
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
  createdAt      DateTime        @default(now())

  goal           Goal            @relation(fields: [goalId], references: [id], onDelete: Cascade)
  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model ActivityLog {
  id             String          @id @default(uuid())
  budgetId       String
  userId         String
  action         String          // e.g., "CATEGORY_LIMIT_UPDATED", "MEMBER_JOINED"
  metadata       Json?           // Detalles extra del evento
  createdAt      DateTime        @default(now())

  budget         Budget          @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  user           User            @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([budgetId])
  @@index([createdAt(sort: Desc)])
}

```

## 5. Business Rules & Core Features

### 5.1. Límites del Sistema

* **Usuarios:** Máximo **3 presupuestos** en propiedad o participación por cuenta.

* **Presupuestos:** Máximo **4 miembros** por presupuesto para garantizar rendimiento en tiempo real y evitar abusos.

### 5.2. Jerarquía de Roles

* **OWNER:** Control total. Puede invitar/expulsar, cambiar divisa, borrar el presupuesto, editar categorías.

* **EDITOR:** Puede añadir/editar/borrar transacciones y metas. No administra el presupuesto.

* **LIMITED_EDITOR (Default al unirse):** Puede añadir transacciones, pero solo puede editar/borrar las creadas por sí mismo.

* **VIEWER:** Acceso de solo lectura.

### 5.3. Gestión de Propiedad y Offboarding

* Si el **OWNER** decide abandonar el presupuesto o eliminar su cuenta, se le exigirá **transferir la propiedad manualmente** a otro miembro.

* **Comportamiento por defecto (Fallback):** Si la cuenta se elimina sin acción previa, el sistema transferirá automáticamente el rol de OWNER al miembro participante más antiguo (`joinedAt` más lejano). Si es el único miembro, el presupuesto se elimina en cascada.

* **Soft Delete de Usuarios:** Se anonimizan los datos (`displayName = "Usuario Eliminado"`) preservando la integridad matemática de sus transacciones y contribuciones pasadas.

### 5.4. Rendimiento y Carga de Datos

* **Paginación por Cursores (Infinite Scroll):** Las transacciones y el `ActivityLog` se sirven en bloques (ej. 20 elementos) mediante cursor en lugar de offset, evitando colapsos de memoria.

* **Caché Reactiva:** El cliente usa `TanStack Query` para la caché en memoria. Los eventos del WebSocket solo disparan invalidaciones estratégicas (`queryClient.invalidateQueries`) en lugar de transportar grandes payloads de datos JSON.

### 5.5. Privacidad y Exportación

* **Modo Blur (Privacidad):** Un toggle global en la UI que difumina instantáneamente todos los importes (CSS filter) para uso en lugares públicos.

* **Exportación CSV:** Endpoint protegido (`/api/v1/budgets/:id/export`) para descargar el histórico de transacciones filtrado por rango de fechas.

### 5.6. Notificaciones In-App & Auditoría

* Se prescinde de Push Notifications complejas en el MVP.

* El modelo `ActivityLog` alimenta un "Muro de Actividad" visible en el presupuesto.

* **Alertas Inteligentes:** UI resalta hitos importantes (Ej. *Presupuesto consumido al 90%*, *Meta lograda*, *Nuevo miembro ingresado*).

## 6. UI, UX & Design Guidelines

El frontend debe sentirse como una aplicación móvil nativa premium, no como una web incrustada. El diseño debe ser sobrio, utilitario y elegante (inspiración estilo Linear/Raycast).

* **Design System & Estilos:** Uso estricto de **NativeWind (Tailwind v4)**. Queda prohibido el uso de `StyleSheet.create` de React Native a menos que sea estrictamente necesario para animaciones complejas.

* **Paleta Semántica:**

  * Interfaz base monocromática (blancos, grises y negros profundos).

  * Colores de acento estrictamente funcionales: Verde Esmeralda (Ingresos/Metas cumplidas), Ámbar/Naranja (Advertencias/Límites cercanos) y Carmesí/Rojo (Gastos/Límites excedidos).

* **Modo Oscuro:** Soporte nativo y fluido de Tema Claro/Oscuro en toda la aplicación usando las clases `dark:` de Tailwind.

* **Interacciones Nativas:**

  * Uso obligatorio de **Safe Areas** (`SafeAreaView` de react-native-safe-area-context) para evitar superposiciones con los bordes de la pantalla (notch).

  * Inputs financieros optimizados: Se debe invocar siempre el **teclado numérico nativo** del dispositivo (`keyboardType="decimal-pad"`), bloqueando caracteres alfabéticos.

  * Feedback táctil (Haptics) en acciones clave (ej. confirmar transacción, cumplir meta).

## 7. Panel de Configuración de Usuario

Estructurado en dos niveles de gestión:

1. **Preferencias de Cuenta (Global):**

   * Edición de `displayName` y Avatar.

   * Gestión de Tema (System / Dark / Light).

   * Vinculación de identidades.

2. **Ajustes del Presupuesto (Contextual, requiere permisos):**

   * Configuración de Divisa Base (Solo OWNER).

   * Gestión de Miembros y Roles (Solo OWNER).

   * Exportación de Datos a CSV.

## 8. Logging & Observability

* **Pino (Backend):** Logs estructurados en JSON ultrarrápidos para depuración en servidor.

* **Sentry (Fullstack):** Detección de crashes, trazas de errores de UI y fallos de promesa no controlados.

## 9. Metodología de Desarrollo: Strict TDD

El proyecto operará exclusivamente bajo TDD (Test-Driven Development):

1. **Rojo:** Escribir un test fallido (Vitest/Supertest) para la lógica a implementar.

2. **Verde:** Escribir el código mínimo de producción para pasar el test.

3. **Refactor:** Limpiar código y mejorar estructura sin romper las pruebas.
   *(Está estrictamente prohibido generar código de producción antes que la suite de pruebas).*

## 10. CI/CD y Empaquetado (EAS Build)

La distribución y el empaquetado de la aplicación se gestionarán íntegramente a través de **Expo Application Services (EAS)**, delegando la compilación a la nube.

### 10.1. Estrategia de Compilación por Plataforma

* **Android:**

  * Compilación de archivos **`.apk`** para distribución rápida y testing interno.

  * Compilación de **`.aab`** (Android App Bundle) optimizados y firmados para el despliegue final en la Google Play Store.

* **iOS:**

  * Generación de *Simulator Builds* para pruebas locales sin necesidad de cuentas de desarrollador de Apple en fases tempranas.

  * Generación de archivos **`.ipa`** firmados para distribución a través de TestFlight (requiere membresía del Apple Developer Program).

### 10.2. Entornos de Configuración (`eas.json`)

Se configurarán tres perfiles (profiles) distintos de construcción:

* **`development`**: Orientado al desarrollo. Crea un cliente de desarrollo personalizado (Expo Dev Client) para probar módulos nativos complejos fuera de Expo Go.

* **`preview`**: Entorno *staging* idéntico a producción pero conectado a variables de entorno de prueba. Usado para QA y validación del comportamiento de los binarios finales.

* **`production`**: Pipeline automatizado que minifica el código, elimina herramientas de depuración, aplica firmas criptográficas y apunta al backend/Supabase de producción.