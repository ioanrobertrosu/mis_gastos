import { focusManager, useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { AppState, type AppStateStatus, Text } from 'react-native';

import { QueryProvider } from '@/api/query-provider';
import RootLayout from '@/app/_layout';

function UsesQueryClient() {
  useQueryClient();
  return <Text>Con QueryClient</Text>;
}

describe('QueryProvider', () => {
  it('da acceso al QueryClient y conserva el mismo entre renderizados', async () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useQueryClient());
      return null;
    }
    const { rerender } = await render(
      <QueryProvider>
        <Probe />
      </QueryProvider>,
    );
    await rerender(
      <QueryProvider>
        <Probe />
      </QueryProvider>,
    );

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);
  });

  it('avisa a TanStack Query cuando la app pasa a segundo plano y vuelve (refresca al volver)', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove };
    });

    const { unmount } = await render(
      <QueryProvider>
        <UsesQueryClient />
      </QueryProvider>,
    );

    listener?.('background');
    expect(focusManager.isFocused()).toBe(false);
    listener?.('active');
    expect(focusManager.isFocused()).toBe(true);

    await unmount();
    expect(remove).toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('el layout raíz lo proporciona a todas las pantallas', async () => {
    await renderRouter({ _layout: RootLayout, index: UsesQueryClient });

    expect(screen.getByText('Con QueryClient')).toBeOnTheScreen();
  });
});
