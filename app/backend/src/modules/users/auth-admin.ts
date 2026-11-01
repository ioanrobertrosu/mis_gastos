/** Operaciones de administración sobre Supabase Auth. Inyectable para no llamar a Supabase en los tests. */
export interface AuthAdmin {
  deleteUser(userId: string): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    authAdmin: AuthAdmin;
  }
}

export interface SupabaseAuthAdminOptions {
  url: string;
  serviceRoleKey: string;
  fetch?: typeof globalThis.fetch;
}

/** No hace nada: para entornos (tests) que no deben tocar Supabase Auth. */
export const NOOP_AUTH_ADMIN: AuthAdmin = { deleteUser: async () => {} };

export function createSupabaseAuthAdmin({
  url,
  serviceRoleKey,
  fetch = globalThis.fetch,
}: SupabaseAuthAdminOptions): AuthAdmin {
  const baseUrl = url.replace(/\/+$/, '');
  // Las claves `sb_secret_…` solo se aceptan como Bearer si coinciden con la cabecera `apikey`.
  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };

  return {
    async deleteUser(userId) {
      const response = await fetch(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers,
      });
      // 404: ya no existe, que es justo el estado buscado.
      if (response.ok || response.status === 404) return;
      throw new Error(`Supabase Auth respondió ${response.status} al borrar el usuario`);
    },
  };
}
