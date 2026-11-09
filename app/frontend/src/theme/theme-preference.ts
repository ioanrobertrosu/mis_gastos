import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

/** Preferencia de tema del usuario. Solo es una preferencia de UI: nunca datos de la app. */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCE_KEY = 'mis_gastos.theme';

const PREFERENCES: readonly string[] = ['system', 'light', 'dark'] satisfies ThemePreference[];

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && PREFERENCES.includes(value);
}

/**
 * Fuerza el esquema en iOS/Android; `system` vuelve al del dispositivo. En web no hay efecto:
 * react-native-web no implementa `setColorScheme` y NativeWind resuelve `dark:` con el
 * `prefers-color-scheme` del navegador.
 */
export function applyThemePreference(preference: ThemePreference): void {
  // El tipo dice que siempre existe; en web no.
  if (typeof Appearance.setColorScheme !== 'function') return;
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

/** Preferencia guardada; ante un valor desconocido o un fallo del almacenamiento, `system`. */
export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const stored = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Aplica la preferencia de inmediato y la guarda para los siguientes arranques. */
export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  applyThemePreference(preference);
  await AsyncStorage.setItem(THEME_PREFERENCE_KEY, preference);
}
