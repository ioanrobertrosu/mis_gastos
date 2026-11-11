import { useUiStore } from '@/stores/ui-store';

const A = 'budget-a';
const B = 'budget-b';

// Sin componentes renderizados no hace falta `act`: se usa el store directamente.
beforeEach(() => {
  useUiStore.getState().reset();
});

describe('store de UI efímera (Zustand)', () => {
  it('empieza con los importes visibles, sin filtros y sin modal abierto', () => {
    expect(useUiStore.getState()).toMatchObject({
      amountsHidden: false,
      transactionFilters: {},
      activeModal: null,
    });
  });

  it('el modo blur se activa y se desactiva', () => {
    useUiStore.getState().toggleAmountsHidden();
    expect(useUiStore.getState().amountsHidden).toBe(true);

    useUiStore.getState().toggleAmountsHidden();
    expect(useUiStore.getState().amountsHidden).toBe(false);
  });

  it('los filtros de transacciones son por presupuesto y se sustituyen al cambiarlos', () => {
    const { setTransactionFilters } = useUiStore.getState();
    setTransactionFilters(A, { categoryId: 'c1' });
    setTransactionFilters(B, { isRecurring: true });
    setTransactionFilters(A, { from: '2026-11-01' });

    expect(useUiStore.getState().transactionFilters).toEqual({
      [A]: { from: '2026-11-01' },
      [B]: { isRecurring: true },
    });
  });

  it('limpiar los filtros de un presupuesto no toca los de otro', () => {
    const { setTransactionFilters, clearTransactionFilters } = useUiStore.getState();
    setTransactionFilters(A, { categoryId: 'c1' });
    setTransactionFilters(B, { isRecurring: true });
    clearTransactionFilters(A);

    expect(useUiStore.getState().transactionFilters).toEqual({ [B]: { isRecurring: true } });
  });

  it('solo hay un modal abierto: abrir otro lo sustituye y cerrar deja ninguno', () => {
    const { openModal, closeModal } = useUiStore.getState();

    openModal('new-transaction');
    expect(useUiStore.getState().activeModal).toBe('new-transaction');
    openModal('invite-member');
    expect(useUiStore.getState().activeModal).toBe('invite-member');
    closeModal();
    expect(useUiStore.getState().activeModal).toBeNull();
  });

  it('reset (al cerrar sesión) vuelve al estado inicial', () => {
    const state = useUiStore.getState();
    state.toggleAmountsHidden();
    state.setTransactionFilters(A, { categoryId: 'c1' });
    state.openModal('new-transaction');
    state.reset();

    expect(useUiStore.getState()).toMatchObject({
      amountsHidden: false,
      transactionFilters: {},
      activeModal: null,
    });
  });

  it('no se guarda en ningún almacenamiento: es estado efímero', () => {
    expect(useUiStore).not.toHaveProperty('persist');
  });
});
