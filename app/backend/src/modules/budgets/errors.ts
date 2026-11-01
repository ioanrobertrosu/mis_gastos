import { ForbiddenError, NotFoundError } from '../../shared/errors.js';

/** Mismo error si el presupuesto no existe o si el usuario no es miembro: no se revela cuál. */
export function budgetNotFound(): NotFoundError {
  return new NotFoundError('Presupuesto no encontrado');
}

export function roleForbidden(): ForbiddenError {
  return new ForbiddenError('Tu rol en este presupuesto no permite esta acción');
}
