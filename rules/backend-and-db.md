# Reglas de Backend y Base de Datos

*   **Soft Delete por Defecto:** Al eliminar categorías u otros datos relacionales donde el PRD indique "Soft Delete", no se usará `prisma.model.delete`, sino `prisma.model.update` cambiando la bandera `isActive` a `false`.
*   **Validación de Entradas:** Todas las rutas de Fastify deben validar sus cargas útiles (Payloads), parámetros de URL y consultas usando el ecosistema de validación por defecto definido en el proyecto (ej. TypeBox o Zod). No procesar datos crudos bajo ninguna circunstancia.
*   **Manejo de UUIDs:** Siempre se usarán identificadores UUID (v4) para parámetros de rutas y claves primarias, validando su formato antes de ejecutar cualquier consulta a la base de datos para evitar errores de Prisma.