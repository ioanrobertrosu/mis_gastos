import type { Role } from '../../generated/prisma/enums.js';

const EVERYONE = ['OWNER', 'EDITOR', 'LIMITED_EDITOR', 'VIEWER'] as const;

/** Matriz de permisos (PRD §5.2): roles autorizados para cada acción sobre un presupuesto. */
const PERMISSIONS = {
  'budget:read': EVERYONE,
  'budget:export': EVERYONE,
  'budget:update': ['OWNER'],
  'budget:delete': ['OWNER'],
  'member:manage': ['OWNER'],
  'invite:manage': ['OWNER'],
  'category:manage': ['OWNER'],
  'goal:manage': ['OWNER', 'EDITOR'],
  // Aportar a una meta es como registrar dinero: quien puede crear transacciones.
  'goal:contribute': ['OWNER', 'EDITOR', 'LIMITED_EDITOR'],
  'transaction:create': ['OWNER', 'EDITOR', 'LIMITED_EDITOR'],
  'transaction:edit-any': ['OWNER', 'EDITOR'],
  // LIMITED_EDITOR: solo las transacciones que creó él (lo comprueba el módulo de transacciones).
  'transaction:edit-own': ['OWNER', 'EDITOR', 'LIMITED_EDITOR'],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

export function can(role: Role, action: Action): boolean {
  return (PERMISSIONS[action] as readonly Role[]).includes(role);
}
