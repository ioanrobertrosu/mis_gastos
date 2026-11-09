import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Card } from '@/components/card';

describe('Card', () => {
  it('agrupa su contenido', async () => {
    await render(
      <Card>
        <Text>Comida</Text>
        <Text>Ocio</Text>
      </Card>,
    );

    expect(screen.getByText('Comida')).toBeOnTheScreen();
    expect(screen.getByText('Ocio')).toBeOnTheScreen();
  });
});
