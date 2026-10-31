/** Error de negocio con un código HTTP y un código estable para el cliente. */
export class DomainError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Recurso no encontrado') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'No tienes permiso para realizar esta acción') {
    super(403, 'FORBIDDEN', message);
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'El recurso entra en conflicto con su estado actual') {
    super(409, 'CONFLICT', message);
  }
}

export class LimitExceededError extends DomainError {
  constructor(message = 'Se ha superado el límite permitido') {
    super(422, 'LIMIT_EXCEEDED', message);
  }
}

export class RateLimitedError extends DomainError {
  constructor(message = 'Demasiadas peticiones, inténtalo más tarde') {
    super(429, 'RATE_LIMITED', message);
  }
}
