import { toCents } from '@/utils/money';

/** Tonos semánticos del PRD: base monocroma y acentos solo con significado. */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * Tono del gasto de una categoría, con las mismas reglas que las alertas del backend y en
 * céntimos exactos (`percentUsed` llega redondeado: 89,99 % sería 90,0 y no hay alerta).
 * Por debajo del 90 % es neutro: el esmeralda queda para metas cumplidas e ingresos.
 */
export function spendingTone({ spent, limit }: { spent: string; limit: string }): Tone {
  const spentCents = toCents(spent);
  const limitCents = toCents(limit);
  if (limitCents === 0n) return 'neutral';
  if (spentCents > limitCents) return 'danger';
  return spentCents * 10n >= limitCents * 9n ? 'warning' : 'neutral';
}

/**
 * Clases por tono, escritas enteras: Tailwind solo genera las clases que encuentra literalmente.
 * `text`: importes y etiquetas; `bar`: relleno de barras de progreso.
 */
export const TONE_CLASSES = {
  neutral: { text: 'text-zinc-900 dark:text-zinc-100', bar: 'bg-zinc-400 dark:bg-zinc-500' },
  success: {
    text: 'text-emerald-700 dark:text-emerald-400',
    bar: 'bg-emerald-600 dark:bg-emerald-500',
  },
  warning: { text: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-500 dark:bg-amber-400' },
  danger: { text: 'text-red-700 dark:text-red-400', bar: 'bg-red-600 dark:bg-red-500' },
} as const satisfies Record<Tone, { text: string; bar: string }>;
