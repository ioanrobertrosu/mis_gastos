# Reglas de Metodología

*   **TDD Estricto por Defecto:** Para cualquier lógica de negocio en el backend (`Fastify`) o utilidades core, ESTÁ PROHIBIDO escribir código de producción sin antes escribir y mostrar el test fallido (Fase Roja) usando `Vitest`.
*   **Aprobación del Usuario:** El asistente debe detenerse tras generar el test fallido y pedir permiso al usuario para continuar con la implementación (Fase Verde).
*   **Refactorización Segura:** En la Fase de Refactorización, no se debe alterar la lógica funcional probada, solo optimizar la legibilidad y la estructura del código.