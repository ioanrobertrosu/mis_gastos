import { render, screen } from '@testing-library/react-native';

import { Amount } from '@/components/amount';
import { TONE_CLASSES } from '@/theme/tone';

// Intl separa la cifra del símbolo con un espacio duro (U+00A0).
const nbsp = (text: string) => text.replace(/ /g, ' ');

describe('Amount', () => {
  it.each([
    ['12345.6', 'EUR', '12.345,60 €'],
    ['0.00', 'EUR', '0,00 €'],
    ['1234.5', 'USD', '1234,50 US$'],
  ] as const)('formatea %s %s como %j', async (value, currency, formatted) => {
    await render(<Amount value={value} currency={currency} />);

    expect(screen.getByText(nbsp(formatted))).toBeOnTheScreen();
  });

  it('oculto (modo blur) no muestra la cifra y se anuncia como "Importe oculto"', async () => {
    await render(<Amount value="12345.60" currency="EUR" hidden />);

    expect(screen.getByLabelText('Importe oculto')).toBeOnTheScreen();
    expect(screen.queryByText(/12/)).toBeNull();
  });

  it('aplica la clase del tono semántico', async () => {
    await render(<Amount value="150.00" currency="EUR" tone="danger" />);

    expect(screen.getByText(nbsp('150,00 €')).props.className).toContain(TONE_CLASSES.danger.text);
  });
});
