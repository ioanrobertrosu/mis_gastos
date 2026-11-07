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

/** Salas por presupuesto, en memoria: una sola instancia del backend. */
export class RealtimeHub {
  private readonly rooms = new Map<string, Set<WebSocket>>();

  /**
   * Notifica a los suscritos. Las rutas lo llaman tras confirmarse la mutación, así que un fallo
   * de envío a una conexión no debe afectar ni a las demás ni a la respuesta REST.
   */
  publish(event: RealtimeEvent): void {
    const message = JSON.stringify(event);
    for (const socket of this.rooms.get(event.budgetId) ?? []) {
      if (socket.readyState !== socket.OPEN) continue;
      try {
        socket.send(message);
      } catch {
        // La conexión se está cerrando: su evento `close` la sacará de la sala.
      }
    }
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

  /** Saca la conexión de todas sus salas (al cerrarse). */
  disconnect(socket: WebSocket): void {
    for (const budgetId of [...this.rooms.keys()]) this.leave(budgetId, socket);
  }
}
