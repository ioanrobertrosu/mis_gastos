import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Screen } from '@/components/screen';

describe('Screen', () => {
  it('muestra su contenido dentro de un SafeAreaView (notch, isla dinámica, barras del sistema)', async () => {
    await render(
      <Screen>
        <Text>Contenido</Text>
      </Screen>,
    );

    // RNTL 14 ya no busca por componente: se comprueba el elemento nativo de safe-area-context.
    const root = screen.toJSON() as { type: string } | null;
    expect(root?.type).toBe('RNCSafeAreaView');
    expect(screen.getByText('Contenido')).toBeOnTheScreen();
  });
});
