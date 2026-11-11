import '@/global.css';

import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { QueryProvider } from '@/api/query-provider';
import { applyThemePreference, loadThemePreference } from '@/theme/theme-preference';

export default function RootLayout() {
  // Mientras se lee la preferencia guardada se usa la del sistema.
  useEffect(() => {
    void loadThemePreference().then(applyThemePreference);
  }, []);

  return (
    <QueryProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryProvider>
  );
}
