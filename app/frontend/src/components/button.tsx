import { Pressable } from 'react-native';

import { Text } from '@/components/text';

const VARIANT_CLASSES = {
  primary: {
    container: 'bg-zinc-900 dark:bg-zinc-100',
    label: 'text-white dark:text-zinc-900',
  },
  secondary: {
    container: 'border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950',
    label: 'text-zinc-900 dark:text-zinc-100',
  },
  destructive: { container: 'bg-red-600 dark:bg-red-500', label: 'text-white dark:text-white' },
} as const;

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: keyof typeof VARIANT_CLASSES;
  disabled?: boolean;
}

export function Button({ label, onPress, variant = 'primary', disabled = false }: ButtonProps) {
  const classes = VARIANT_CLASSES[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 items-center justify-center rounded-xl px-4 active:opacity-80 ${
        disabled ? 'opacity-40' : ''
      } ${classes.container}`}
    >
      <Text className={`font-semibold ${classes.label}`}>{label}</Text>
    </Pressable>
  );
}
