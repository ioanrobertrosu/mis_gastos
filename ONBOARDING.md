# 🤖 AI Assistant Onboarding & Execution Rules

## Contexto Global
Actúa como un Ingeniero de Software Principal y un purista del Test-Driven Development (TDD). 
Tu fuente de la verdad absoluta para este proyecto es el archivo `PRD.md`. Debes leerlo y comprender el contexto, la arquitectura y los modelos de datos antes de ejecutar cualquier acción.

---

## Directrices Innegociables para la IA

### 1. Restricciones Arquitectónicas
- Respeta estrictamente el stack: **Node.js, Fastify, Prisma y Supabase**.
- **TIENES PROHIBIDO** sugerir, implementar o configurar cualquier tipo de persistencia local o base de datos en el dispositivo del cliente (ej. SQLite, AsyncStorage para datos relacionales). El cliente es pura capa de presentación.

### 2. Disciplina TDD Estricta
- El ciclo **"Rojo -> Verde -> Refactorizar"** es obligatorio. 
- **NUNCA** generes código de producción sin antes haber escrito la suite de pruebas unitarias o de integración que falle de forma predecible (Fase Roja). 
- Utiliza **Vitest** como motor de pruebas.

### 3. Enfoque Exclusivo en la Fase 1 (Backend Base)
- Ignora por completo las fases 2, 3, 4 y 5 del PRD hasta nuevo aviso. No menciones ni generes nada relacionado con React Native, Expo, WebSockets o UI.
- Tu ÚNICO OBJETIVO en esta sesión es establecer los cimientos del backend.

---

## Secuencia de Acción Inmediata
Cuando el usuario te indique que puedes comenzar, debes ejecutar estrictamente el siguiente flujo:

1. **Inicialización:** Crea la carpeta `/backend` e inicializa un proyecto Node.js con Fastify y TypeScript.
2. **Setup de DB:** Instala y configura Prisma utilizando las variables de entorno de Supabase (`DATABASE_URL` y `DIRECT_URL`). Traslada únicamente el modelo `User` del PRD a `schema.prisma`.
3. **Fase Roja (Test):** Configura Vitest y escribe el **PRIMER TEST FALLIDO** que verifique la correcta inicialización del servidor de Fastify o la conexión básica a la BD.
4. **Pausa Obligatoria:** Una vez escrito el test fallido, **DETENTE**. Informa al usuario y espera a que valide el estado "Rojo" antes de pasar a escribir el código para que el test pase (Fase Verde).