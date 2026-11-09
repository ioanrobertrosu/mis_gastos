import { render, screen } from '@testing-library/react-native';

import { Text } from '@/components/text';
import { TONE_CLASSES } from '@/theme/tone';

describe('Text', () => {
  it('muestra su contenido', async () => {
    await render(<Text>Comida</Text>);

    expect(screen.getByText('Comida')).toBeOnTheScreen();
  });

  it('la variante title es un encabezado para la accesibilidad', async () => {
    await render(<Text variant="title">Resumen</Text>);

    expect(screen.getByRole('header', { name: 'Resumen' })).toBeOnTheScreen();
  });

  it('el texto normal no es un encabezado', async () => {
    await render(<Text>Comida</Text>);

    expect(screen.queryByRole('header')).toBeNull();
  });

  it('aplica la clase del tono semántico', async () => {
    await render(<Text tone="danger">Excedido</Text>);

    expect(screen.getByText('Excedido').props.className).toContain(TONE_CLASSES.danger.text);
  });
});
