import type { WebSocket } from 'ws';

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeHub;
  }
}

/**
 * Evento ligero: solo indica qué ha cambiado, para que el cliente invalide su caché y vuelva a
 * pedir los datos con sus permisos. Nunca lleva importes ni otros datos.
 */
export interface RealtimeEvent {
  type: 'created' | 'updated' | 'deleted';
  budgetId: string;
  entity: 'budget' | 'member' | 'category' | 'transaction' | 'goal';
  id: string;
}

/** Motivo por el que una conexión deja de estar suscrita sin haberlo pedido. */
export type UnsubscribeReason = 'REMOVED' | 'LEFT' | 'BUDGET_DELETED';

/** Cierre por cuenta borrada: distinto de 4401, reconectar con otro token no serviría. */
export const CLOSE_ACCOUNT_DELETED = 4403;

function trySend(socket: WebSocket, message: string): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(message);
  } catch {
    // La conexión se está cerrando: su evento `close` la sacará de las salas.
  }
}

/** Salas por presupuesto, en memoria: una sola instancia del backend. */
export class RealtimeHub {
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly connections = new Map<string, Set<WebSocket>>();

  /**
   * Notifica a los suscritos. Las rutas lo llaman tras confirmarse la mutación, así que un fallo
   * de envío a una conexión no debe afectar ni a las demás ni a la respuesta REST.
   */
  publish(event: RealtimeEvent): void {
    const message = JSON.stringify(event);
    for (const socket of this.rooms.get(event.budgetId) ?? []) trySend(socket, message);
  }

  /** Registra la conexión de un usuario, esté o no suscrita a algo. */
  connect(userId: string, socket: WebSocket): void {
    const sockets = this.connections.get(userId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.connections.set(userId, sockets);
  }

  /** Olvida la conexión y la saca de todas sus salas (al cerrarse). */
  disconnect(userId: string, socket: WebSocket): void {
    for (const budgetId of [...this.rooms.keys()]) this.leave(budgetId, socket);
    const sockets = this.connections.get(userId);
    sockets?.delete(socket);
    if (sockets?.size === 0) this.connections.delete(userId);
  }

  join(budgetId: string, socket: WebSocket): void {
    const room = this.rooms.get(budgetId) ?? new Set<WebSocket>();
    room.add(socket);
    this.rooms.set(budgetId, room);
  }

  leave(budgetId: string, socket: WebSocket): void {
    const room = this.rooms.get(budgetId);
    room?.delete(socket);
    if (room?.size === 0) this.rooms.delete(budgetId);
  }

  /**
   * El usuario ya no es miembro: saca sus conexiones de la sala y se lo avisa. Llamarlo antes de
   * publicar la baja, para que el evento solo llegue a quienes siguen siendo miembros.
   */
  removeMember(budgetId: string, userId: string, reason: UnsubscribeReason): void {
    const room = this.rooms.get(budgetId);
    for (const socket of this.connections.get(userId) ?? []) {
      if (!room?.has(socket)) continue;
      this.leave(budgetId, socket);
      trySend(socket, JSON.stringify({ type: 'unsubscribed', budgetId, reason }));
    }
  }

  /** El presupuesto ya no existe: avisa a todos sus suscritos y vacía la sala. */
  closeRoom(budgetId: string, reason: UnsubscribeReason): void {
    const message = JSON.stringify({ type: 'unsubscribed', budgetId, reason });
    for (const socket of this.rooms.get(budgetId) ?? []) trySend(socket, message);
    this.rooms.delete(budgetId);
  }

  /** Cierra todas las conexiones del usuario (su evento `close` las saca de las salas). */
  closeUser(userId: string, code: number, reason: string): void {
    for (const socket of this.connections.get(userId) ?? []) socket.close(code, reason);
  }
}
