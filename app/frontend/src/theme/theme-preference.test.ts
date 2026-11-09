import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, waitFor } from 'expo-router/testing-library';
import { Appearance } from 'react-native';

import RootLayout from '@/app/_layout';
import Index from '@/app/index';
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  THEME_PREFERENCE_KEY,
} from '@/theme/theme-preference';

let setColorScheme: jest.SpyInstance;

beforeEach(() => {
  setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
});

afterEach(() => {
  setColorScheme.mockRestore();
});

describe('preferencia de tema (System / Dark / Light)', () => {
  it('sin nada guardado es "system"', async () => {
    await expect(loadThemePreference()).resolves.toBe('system');
  });

  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['system', 'unspecified'],
  ] as const)(
    'guardar "%s" la persiste y la aplica (Appearance %s)',
    async (preference, scheme) => {
      await saveThemePreference(preference);

      expect(setColorScheme).toHaveBeenLastCalledWith(scheme);
      await expect(loadThemePreference()).resolves.toBe(preference);
    },
  );

  it('un valor guardado desconocido se trata como "system"', async () => {
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, 'morado');

    await expect(loadThemePreference()).resolves.toBe('system');
  });

  it('si el almacenamiento falla, usa "system" sin romper la app', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('almacenamiento roto'));

    await expect(loadThemePreference()).resolves.toBe('system');
  });

  it('al arrancar, la app aplica la preferencia guardada', async () => {
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, 'dark');

    await renderRouter({ _layout: RootLayout, index: Index });

    // La lectura del almacenamiento es asíncrona: se aplica en cuanto termina.
    await waitFor(() => expect(setColorScheme).toHaveBeenCalledWith('dark'));
  });

  it('en web (react-native-web no implementa setColorScheme) no rompe: sigue al navegador', () => {
    setColorScheme.mockRestore();
    const original = Appearance.setColorScheme;
    // @ts-expect-error: así es el Appearance de react-native-web.
    delete Appearance.setColorScheme;
    try {
      expect(() => applyThemePreference('dark')).not.toThrow();
    } finally {
      Appearance.setColorScheme = original;
      setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    }
  });
});
