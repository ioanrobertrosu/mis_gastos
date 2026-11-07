import type { WebSocket } from 'ws';

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeHub;
  }
}

/** Salas por presupuesto, en memoria: una sola instancia del backend. */
export class RealtimeHub {
  private readonly rooms = new Map<string, Set<WebSocket>>();

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
