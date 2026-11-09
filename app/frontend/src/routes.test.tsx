import { renderRouter, screen } from 'expo-router/testing-library';

import RootLayout from '@/app/_layout';
import Index from '@/app/index';

// Rutas reales de src/app (los tests no pueden vivir dentro: todo lo que hay allí es una ruta).
const routes = { _layout: RootLayout, index: Index };

describe('navegación', () => {
  it('abre en la pantalla inicial con el nombre de la app como encabezado', async () => {
    await renderRouter(routes);

    expect(screen).toHavePathname('/');
    expect(screen.getByRole('header', { name: 'Mis Gastos' })).toBeOnTheScreen();
  });
});
