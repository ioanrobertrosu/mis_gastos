import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { TONE_CLASSES, type Tone } from '@/theme/tone';

const VARIANT_CLASSES = {
  title: 'text-2xl font-semibold',
  body: 'text-base',
  caption: 'text-sm',
} as const;

export interface TextProps extends NativeTextProps {
  variant?: keyof typeof VARIANT_CLASSES;
  tone?: Tone;
  className?: string;
}

/** Texto con las variantes de la app. `title` se anuncia como encabezado. */
export function Text({ variant = 'body', tone = 'neutral', className, ...props }: TextProps) {
  return (
    <NativeText
      accessibilityRole={variant === 'title' ? 'header' : undefined}
      {...props}
      className={[VARIANT_CLASSES[variant], TONE_CLASSES[tone].text, className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
