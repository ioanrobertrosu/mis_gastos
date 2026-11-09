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

### 3. Enfoque Actual: Fase 9 (Cimientos del Frontend)
- El backend está completo y en producción (fases 0–8 de `TODO.md`). Desbloqueado el frontend el 2026-11-09 a petición del usuario.
- El objetivo es la app Expo en `app/frontend`, en el orden de la Fase 9 de `TODO.md`, con el mismo TDD estricto (`jest-expo` + React Native Testing Library).
- Expo cambia en cada SDK: antes de usar una API de Expo, consulta la documentación de la versión instalada (SDK 58) y las skills del proyecto. Instala paquetes con `npx expo install`.
- El cliente sigue sin persistencia relacional local (punto 1) y solo consume la API del backend.

---

## Secuencia de Acción Inmediata
Cuando el usuario te indique que puedes comenzar, debes ejecutar estrictamente el siguiente flujo:

1. **Inicialización:** Crea la carpeta `/backend` e inicializa un proyecto Node.js con Fastify y TypeScript.
2. **Setup de DB:** Instala y configura Prisma utilizando las variables de entorno de Supabase (`DATABASE_URL` y `DIRECT_URL`). Traslada únicamente el modelo `User` del PRD a `schema.prisma`.
3. **Fase Roja (Test):** Configura Vitest y escribe el **PRIMER TEST FALLIDO** que verifique la correcta inicialización del servidor de Fastify o la conexión básica a la BD.
4. **Pausa Obligatoria:** Una vez escrito el test fallido, **DETENTE**. Informa al usuario y espera a que valide el estado "Rojo" antes de pasar a escribir el código para que el test pase (Fase Verde).