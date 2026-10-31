# Reglas de Interfaz y Estilos

*   **Uso Exclusivo de NativeWind:** Prohibido usar `StyleSheet.create` o estilos en línea (`style={{...}}`) salvo para casos extremos como animaciones que Tailwind no pueda manejar. Toda la UI debe construirse con clases de utilidad.
*   **Soporte Multi-Tema Obligatorio:** Todos los componentes UI deben estar preparados para el Modo Oscuro utilizando el prefijo `dark:` de Tailwind (ej. `bg-white dark:bg-gray-900 text-black dark:text-white`).
*   **Paleta Semántica Restringida:** Utilizar exclusivamente la paleta definida en el PRD: Verde Esmeralda (éxito/ingresos), Ámbar/Naranja (advertencias), Carmesí/Rojo (gastos/errores) y escala de grises para estructura.