import type { FastifyPluginAsync } from "fastify";
import fastifyWebsocket, { type WebSocket } from "@fastify/websocket";

/** ws.WebSocket.OPEN — a socket is only writable while open. */
const OPEN = 1;

export interface WsHub {
  addClient(socket: WebSocket): void;
  removeClient(socket: WebSocket): void;
  broadcast(subject: string, payload: unknown): void;
  readonly size: number;
}

export class WsHubImpl implements WsHub {
  private clients = new Set<WebSocket>();

  addClient(socket: WebSocket): void {
    this.clients.add(socket);
  }

  removeClient(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  /** Push `{ type, data, ts }` to every connected browser. */
  broadcast(subject: string, payload: unknown): void {
    const message = JSON.stringify({ type: subject, data: payload, ts: new Date().toISOString() });
    for (const socket of this.clients) {
      if (socket.readyState === OPEN) socket.send(message);
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

/** Singleton hub shared by the WS route and the NATS→WS push subscriber. */
export const wsHub = new WsHubImpl();

/** Registers @fastify/websocket and exposes the `/ws` endpoint. */
export const wsPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyWebsocket);

  app.get("/ws", { websocket: true }, (socket) => {
    wsHub.addClient(socket);
    socket.on("close", () => wsHub.removeClient(socket));
    socket.on("error", () => wsHub.removeClient(socket));
  });
};