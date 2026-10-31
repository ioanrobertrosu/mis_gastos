import { describe, expect, it } from 'vitest';
import type { Role } from '../src/generated/prisma/enums.js';
import { ACTIONS, type Action, can } from '../src/modules/budgets/permissions.js';

const ROLES: Role[] = ['OWNER', 'EDITOR', 'LIMITED_EDITOR', 'VIEWER'];

/** Matriz de permisos del PRD §5.2: qué roles pueden realizar cada acción. */
const EXPECTED: Record<Action, Role[]> = {
  'budget:read': ['OWNER', 'EDITOR', 'LIMITED_EDITOR', 'VIEWER'],
  'budget:export': ['OWNER', 'EDITOR', 'LIMITED_EDITOR', 'VIEWER'],
  'budget:update': ['OWNER'],
  'budget:delete': ['OWNER'],
  'member:manage': ['OWNER'],
  'invite:manage': ['OWNER'],
  'category:manage': ['OWNER'],
  'goal:manage': ['OWNER', 'EDITOR'],
  'transaction:create': ['OWNER', 'EDITOR', 'LIMITED_EDITOR'],
  'transaction:edit-any': ['OWNER', 'EDITOR'],
  'transaction:edit-own': ['OWNER', 'EDITOR', 'LIMITED_EDITOR'],
};

describe('matriz de permisos', () => {
  it('cada acción definida tiene su fila en la matriz esperada (y viceversa)', () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  const cases = ROLES.flatMap((role) =>
    (Object.keys(EXPECTED) as Action[]).map(
      (action) => [role, action, EXPECTED[action].includes(role)] as const,
    ),
  );

  it.each(cases)('%s → %s: %s', (role, action, allowed) => {
    expect(can(role, action)).toBe(allowed);
  });
});
