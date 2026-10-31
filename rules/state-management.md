# Reglas de Gestión de Estado y Datos

*   **Prohibición de Fetching en useEffect:** ESTÁ PROHIBIDO usar `useEffect` combinado con `fetch` o `axios` para cargar datos. Todo el estado asíncrono y comunicación con el servidor (REST/WSS) debe manejarse exclusivamente a través de hooks de **TanStack Query** (`useQuery`, `useMutation`).
*   **Estado Global UI Efímero:** El uso de **Zustand** queda estrictamente limitado a estados de UI que no persisten en el servidor (ej. abrir/cerrar modales complejos, filtros de búsqueda activos, pasos de un asistente de configuración).
*   **Invalidación Inteligente:** Las mutaciones exitosas deben usar `queryClient.invalidateQueries` para refrescar la vista en lugar de recargar toda la aplicación.