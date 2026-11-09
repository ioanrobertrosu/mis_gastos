import type { LucideIcon } from 'lucide-react-native';
import { useColorScheme } from 'react-native';

import { TONE_COLORS, type Tone } from '@/theme/tone';

export interface IconProps {
  icon: LucideIcon;
  tone?: Tone;
  size?: number;
  /** Sin etiqueta, el icono es decorativo y los lectores de pantalla lo ignoran. */
  label?: string;
}

export function Icon({ icon: LucideComponent, tone = 'neutral', size = 20, label }: IconProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const color = TONE_COLORS[scheme][tone];
  return label ? (
    // `role`/`aria-label`: Lucide solo reconoce `aria-*`, `role` o `title`; con
    // `accessibilityLabel` seguiría marcándolo `aria-hidden`.
    <LucideComponent color={color} size={size} accessible role="img" aria-label={label} />
  ) : (
    <LucideComponent color={color} size={size} accessible={false} />
  );
}
