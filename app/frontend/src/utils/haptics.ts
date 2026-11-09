import * as Haptics from 'expo-haptics';

/**
 * La vibración acompaña a la acción, nunca la rompe: si el dispositivo no vibra, es web o el
 * módulo nativo falla, se ignora.
 */
function fire(feedback: () => Promise<void>): void {
  try {
    feedback().catch(() => {});
  } catch {
    // Módulo nativo no disponible.
  }
}

/** Vibraciones con significado (PRD): éxito, aviso, error y selección. */
export const haptics = {
  /** Guardar una transacción, cumplir una meta. */
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Un límite cerca o una confirmación delicada. */
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** Una acción que ha fallado. */
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** Cambiar una opción (pestañas, interruptores). */
  selection: () => fire(() => Haptics.selectionAsync()),
};
