import * as ExpoHaptics from 'expo-haptics';

import { haptics } from '@/utils/haptics';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

const notificationAsync = jest.mocked(ExpoHaptics.notificationAsync);
const selectionAsync = jest.mocked(ExpoHaptics.selectionAsync);

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('haptics', () => {
  it.each([
    ['success', ExpoHaptics.NotificationFeedbackType.Success],
    ['warning', ExpoHaptics.NotificationFeedbackType.Warning],
    ['error', ExpoHaptics.NotificationFeedbackType.Error],
  ] as const)('%s vibra con la notificación nativa correspondiente', (event, type) => {
    haptics[event]();

    expect(notificationAsync).toHaveBeenCalledWith(type);
  });

  it('selection vibra con el pulso de selección', () => {
    haptics.selection();

    expect(selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('si el dispositivo no vibra (o es web), no lanza ni deja la promesa sin capturar', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    notificationAsync.mockRejectedValueOnce(new Error('Haptics no disponible'));

    try {
      expect(() => haptics.success()).not.toThrow();
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('si el módulo nativo falla al llamarlo, tampoco lanza', () => {
    notificationAsync.mockImplementationOnce(() => {
      throw new Error('módulo nativo no disponible');
    });

    expect(() => haptics.error()).not.toThrow();
  });
});
