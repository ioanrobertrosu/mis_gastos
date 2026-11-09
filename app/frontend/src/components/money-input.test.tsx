import { fireEvent, render, screen } from '@testing-library/react-native';

import { MoneyInput } from '@/components/money-input';

async function setup(value = '') {
  const onChangeValue = jest.fn();
  await render(<MoneyInput label="Importe" value={value} onChangeValue={onChangeValue} />);
  return { onChangeValue, input: screen.getByLabelText('Importe') };
}

describe('MoneyInput', () => {
  it('abre el teclado decimal nativo', async () => {
    const { input } = await setup();

    expect(input.props.keyboardType).toBe('decimal-pad');
  });

  it('muestra el valor con coma decimal (es-ES)', async () => {
    const { input } = await setup('12.5');

    expect(input).toHaveDisplayValue('12,5');
  });

  it.each([
    ['12,5', '12.5'],
    ['12.50', '12.50'],
    ['12,', '12.'], // estado intermedio mientras se escribe
    [',5', '0.5'],
    ['', ''],
    ['1234567890', '1234567890'],
  ])('acepta %j y emite %j (punto decimal, como la API)', async (typed, emitted) => {
    const { input, onChangeValue } = await setup();

    await fireEvent.changeText(input, typed);

    expect(onChangeValue).toHaveBeenCalledWith(emitted);
  });

  it.each([
    ['letras', '12a'],
    ['tres decimales', '1,234'],
    ['dos separadores', '1,2,3'],
    ['signo negativo', '-5'],
    ['más de 10 cifras enteras (Decimal(12,2))', '12345678901'],
  ])('rechaza %s (%j): no emite nada', async (_case, typed) => {
    const { input, onChangeValue } = await setup('1');

    await fireEvent.changeText(input, typed);

    expect(onChangeValue).not.toHaveBeenCalled();
  });
});
