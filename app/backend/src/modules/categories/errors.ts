import { NotFoundError } from '../../shared/errors.js';

/** Mismo error si no existe o si es de otro presupuesto: no se revela cuál. */
export function categoryNotFound(): NotFoundError {
  return new NotFoundError('Categoría no encontrada');
}
