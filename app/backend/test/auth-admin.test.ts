import { describe, expect, it, vi } from 'vitest';
import { createSupabaseAuthAdmin } from '../src/modules/users/auth-admin.js';

const URL_BASE = 'https://test-project.supabase.co';
const KEY = 'sb_secret_clave-de-test';
const USER_ID = '123e4567-e89b-42d3-a456-426614174000';

function adminWith(status: number, url = URL_BASE) {
  const fetch = vi.fn(async () => new Response(status === 200 ? '{}' : '{"msg":"x"}', { status }));
  return { fetch, admin: createSupabaseAuthAdmin({ url, serviceRoleKey: KEY, fetch }) };
}

describe('createSupabaseAuthAdmin().deleteUser', () => {
  it('borra el usuario con la API de administración de Supabase Auth', async () => {
    const { fetch, admin } = adminWith(200);

    await admin.deleteUser(USER_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `${URL_BASE}/auth/v1/admin/users/${USER_ID}`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ apikey: KEY, authorization: `Bearer ${KEY}` }),
      }),
    );
  });

  it('tolera una barra final en la URL del proyecto', async () => {
    const { fetch, admin } = adminWith(200, `${URL_BASE}/`);

    await admin.deleteUser(USER_ID);

    expect(fetch).toHaveBeenCalledWith(
      `${URL_BASE}/auth/v1/admin/users/${USER_ID}`,
      expect.anything(),
    );
  });

  it('un usuario que ya no existe (404) no es un error: el borrado es idempotente', async () => {
    const { admin } = adminWith(404);

    await expect(admin.deleteUser(USER_ID)).resolves.toBeUndefined();
  });

  it('cualquier otra respuesta fallida lanza un error con el estado, sin revelar la clave', async () => {
    const { admin } = adminWith(500);

    const error = await admin.deleteUser(USER_ID).then(
      () => null,
      (reason: unknown) => reason as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('500');
    expect(error?.message).not.toContain(KEY);
  });
});
