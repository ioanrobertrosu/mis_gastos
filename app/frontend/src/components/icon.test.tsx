import { render, screen } from '@testing-library/react-native';
import { Wallet } from 'lucide-react-native';

import { Icon } from '@/components/icon';

// Mismos colores que las clases de texto de cada tono (Tailwind): Lucide recibe `color`, no clases.
const COLORS = {
  light: { neutral: '#18181b', success: '#047857', warning: '#b45309', danger: '#b91c1c' },
  dark: { neutral: '#f4f4f5', success: '#34d399', warning: '#fbbf24', danger: '#f87171' },
} as const;

// `useColorScheme` lee `getColorScheme` del módulo interno de React Native: espiar el objeto
// público `Appearance` no le llega, así que se sustituye el hook.
const mockColorScheme = jest.fn<'light' | 'dark', []>(() => 'light');
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockColorScheme(),
}));

function svg() {
  return screen.toJSON() as unknown as { type: string; props: Record<string, unknown> };
}

afterEach(() => {
  mockColorScheme.mockReturnValue('light');
});

describe('Icon', () => {
  it('sin etiqueta es decorativo: los lectores de pantalla lo ignoran', async () => {
    await render(<Icon icon={Wallet} />);

    expect(svg().type).toBe('RNSVGSvgView');
    expect(svg().props.accessible).toBe(false);
    expect(screen.queryByRole('image')).toBeNull();
  });

  it('con etiqueta es una imagen accesible con ese nombre', async () => {
    await render(<Icon icon={Wallet} label="Presupuesto" />);

    expect(screen.getByRole('image', { name: 'Presupuesto' })).toBeOnTheScreen();
  });

  it('mide 20 por defecto', async () => {
    await render(<Icon icon={Wallet} />);

    expect(svg().props.width).toBe(20);
  });

  it.each(['neutral', 'success', 'warning', 'danger'] as const)(
    'el tono %s usa su color en modo claro y en modo oscuro',
    async (tone) => {
      mockColorScheme.mockReturnValue('light');
      const light = await render(<Icon icon={Wallet} tone={tone} />);
      expect(svg().props.stroke).toBe(COLORS.light[tone]);
      await light.unmount();

      mockColorScheme.mockReturnValue('dark');
      await render(<Icon icon={Wallet} tone={tone} />);
      expect(svg().props.stroke).toBe(COLORS.dark[tone]);
    },
  );
});
