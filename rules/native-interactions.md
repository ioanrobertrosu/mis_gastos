# Reglas de Interacción Nativa

*   **Safe Areas por Defecto:** Cualquier pantalla nueva (`screen`) o layout debe implementar `SafeAreaView` de `react-native-safe-area-context` para garantizar que la UI no se solape con el *notch*, la isla dinámica o las barras de navegación del sistema operativo.
*   **Inputs Financieros Inteligentes:** Cualquier campo de entrada de texto (`TextInput`) que reciba importes económicos debe implementar obligatoriamente `keyboardType="decimal-pad"`.
*   **Feedback Táctil:** Acciones críticas como guardar una transacción, cumplir una meta o eliminar un registro deben disparar una vibración nativa usando `expo-haptics`.