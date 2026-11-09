import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '@/components/button';

describe('Button', () => {
  it('es un botón accesible con su etiqueta que responde al toque', async () => {
    const onPress = jest.fn();
    await render(<Button label="Guardar" onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('deshabilitado se anuncia como tal y no responde', async () => {
    const onPress = jest.fn();
    await render(<Button label="Guardar" onPress={onPress} disabled />);

    const button = screen.getByRole('button', { name: 'Guardar' });
    await fireEvent.press(button);

    expect(button).toBeDisabled();
    expect(onPress).not.toHaveBeenCalled();
  });
});
