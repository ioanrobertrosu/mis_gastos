import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { createQueryClient } from '@/api/query-client';

/**
 * En React Native, TanStack Query no sabe cuándo la app vuelve a primer plano: se lo dice
 * `AppState` (guía oficial). En web ya lo detecta con la visibilidad de la pestaña.
 */
function useAppStateFocus() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => subscription.remove();
  }, []);
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // Un único cliente por app: si se creara en cada render, se perdería la caché.
  const [client] = useState(createQueryClient);
  useAppStateFocus();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
