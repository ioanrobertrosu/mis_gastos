import { TextInput, View } from 'react-native';

import { Text } from '@/components/text';

// Mientras se escribe: hasta 10 cifras enteras (Decimal(12, 2) del backend) y 2 decimales.
const PARTIAL_AMOUNT = /^\d{0,10}(?:\.\d{0,2})?$/;

export interface MoneyInputProps {
  label: string;
  /** Importe con punto decimal, como la API (`"12.5"`); puede estar a medio escribir (`"12."`). */
  value: string;
  onChangeValue: (value: string) => void;
}

/**
 * Campo de importe con el teclado decimal nativo. Acepta coma o punto, muestra coma (es-ES) y
 * emite punto; ignora cualquier otra pulsación. La validación final (`toCents`) es del formulario.
 */
export function MoneyInput({ label, value, onChangeValue }: MoneyInputProps) {
  function handleChange(text: string) {
    let normalized = text.replace(',', '.');
    if (normalized.startsWith('.')) normalized = `0${normalized}`;
    if (PARTIAL_AMOUNT.test(normalized)) onChangeValue(normalized);
  }

  return (
    <View className="gap-1">
      <Text variant="caption" className="text-zinc-500 dark:text-zinc-400">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType="decimal-pad"
        inputMode="decimal"
        placeholder="0,00"
        value={value.replace('.', ',')}
        onChangeText={handleChange}
        className="min-h-12 rounded-xl border border-zinc-300 bg-white px-4 text-lg text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
    </View>
  );
}
