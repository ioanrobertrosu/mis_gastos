import { create } from 'zustand';

import type { TransactionFilters } from '@/api/query-keys';

/** Modales que se abren desde varias pantallas. */
export type ModalName = 'new-transaction' | 'invite-member';

interface UiState {
  /** Modo blur: oculta todos los importes. */
  amountsHidden: boolean;
  /** Filtros activos de la lista de transacciones, por presupuesto. */
  transactionFilters: Record<string, TransactionFilters>;
  activeModal: ModalName | null;
  toggleAmountsHidden: () => void;
  setTransactionFilters: (budgetId: string, filters: TransactionFilters) => void;
  clearTransactionFilters: (budgetId: string) => void;
  openModal: (modal: ModalName) => void;
  closeModal: () => void;
  /** Al cerrar sesión. */
  reset: () => void;
}

const INITIAL = {
  amountsHidden: false,
  transactionFilters: {},
  activeModal: null,
} satisfies Partial<UiState>;

/**
 * Solo estado de UI efímero (reglas de estado): nada que venga del servidor, que es de TanStack
 * Query, y sin persistencia: se pierde al cerrar la app.
 */
export const useUiStore = create<UiState>()((set) => ({
  ...INITIAL,
  toggleAmountsHidden: () => set((state) => ({ amountsHidden: !state.amountsHidden })),
  setTransactionFilters: (budgetId, filters) =>
    set((state) => ({ transactionFilters: { ...state.transactionFilters, [budgetId]: filters } })),
  clearTransactionFilters: (budgetId) =>
    set((state) => {
      const { [budgetId]: _removed, ...rest } = state.transactionFilters;
      return { transactionFilters: rest };
    }),
  openModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null }),
  reset: () => set(INITIAL),
}));
