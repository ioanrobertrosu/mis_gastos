import { spendingTone, TONE_CLASSES, type Tone } from '@/theme/tone';

describe('spendingTone', () => {
  // Mismas reglas que las alertas del backend, en decimal exacto (no con `percentUsed`, redondeado).
  it.each([
    ['0.00', '300.00', 'neutral'],
    ['89.99', '100.00', 'neutral'], // percentUsed llega como 90.0, pero no hay alerta
    ['90.00', '100.00', 'warning'],
    ['100.00', '100.00', 'warning'], // agotado, no excedido
    ['100.01', '100.00', 'danger'],
    ['5.00', '0.00', 'neutral'], // sin límite no hay porcentaje
  ] as const)('gasto %s de %s → %s', (spent, limit, tone) => {
    expect(spendingTone({ spent, limit })).toBe(tone);
  });
});

describe('TONE_CLASSES', () => {
  const tones = Object.keys(TONE_CLASSES) as Tone[];
  const PALETTE = new Set(['zinc', 'emerald', 'amber', 'red', 'white', 'black']);

  it('cubre los cuatro tonos semánticos', () => {
    expect(tones.sort()).toEqual(['danger', 'neutral', 'success', 'warning']);
  });

  it.each(tones)('el tono %s tiene variante oscura en cada clase de color', (tone) => {
    for (const classes of Object.values(TONE_CLASSES[tone])) {
      const light = classes.split(' ').filter((c) => !c.startsWith('dark:'));
      const dark = classes.split(' ').filter((c) => c.startsWith('dark:'));
      expect(dark).toHaveLength(light.length);
    }
  });

  it.each(tones)(
    'el tono %s solo usa la paleta del PRD (grises, esmeralda, ámbar, rojo)',
    (tone) => {
      for (const classes of Object.values(TONE_CLASSES[tone])) {
        for (const cls of classes.split(' ')) {
          const color = cls.replace(/^dark:/, '').match(/^(?:bg|text|border)-([a-z]+)/)?.[1];
          expect(color).toBeDefined();
          expect(PALETTE).toContain(color);
        }
      }
    },
  );
});
