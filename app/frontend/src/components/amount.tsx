import { Text } from '@/components/text';
import type { Tone } from '@/theme/tone';
import { type Currency, toCents } from '@/utils/money';

// Fijo en español por ahora: la app y sus textos son en español.
const LOCALE = 'es-ES';

export interface AmountProps {
  /** Importe de la API (`"12.50"`). */
  value: string;
  currency: Currency;
  tone?: Tone;
  /** Modo blur: no se muestra ni se anuncia la cifra. */
  hidden?: boolean;
  className?: string;
}

export function Amount({
  value,
  currency,
  tone = 'neutral',
  hidden = false,
  className,
}: AmountProps) {
  if (hidden) {
    return (
      <Text tone={tone} accessibilityLabel="Importe oculto" className={className}>
        ••••
      </Text>
    );
  }
  // `toCents` valida el formato; los céntimos caben de sobra en un Number (máx. 10 cifras enteras).
  const formatted = new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(
    Number(toCents(value)) / 100,
  );
  return (
    <Text tone={tone} className={['tabular-nums', className].filter(Boolean).join(' ')}>
      {formatted}
    </Text>
  );
}
