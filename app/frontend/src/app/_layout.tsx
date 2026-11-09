import '@/global.css';

import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { applyThemePreference, loadThemePreference } from '@/theme/theme-preference';

export default function RootLayout() {
  // Mientras se lee la preferencia guardada se usa la del sistema.
  useEffect(() => {
    void loadThemePreference().then(applyThemePreference);
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
