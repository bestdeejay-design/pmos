import { test, expect, vi } from "vitest";
import type { WebSocket } from "ws";
import { WsHubImpl } from "../src/plugins/ws.js";

interface FakeSocket {
  send: ReturnType<typeof vi.fn>;
  readyState: number;
}

function fakeSocket(readyState = 1): FakeSocket {
  return { send: vi.fn(), readyState };
}

function asWs(s: FakeSocket): WebSocket {
  return s as unknown as WebSocket;
}

test("broadcast sends a JSON envelope to every open client", () => {
  const hub = new WsHubImpl();
  const a = fakeSocket();
  const b = fakeSocket();
  hub.addClient(asWs(a));
  hub.addClient(asWs(b));

  hub.broadcast("pmos.tasks.tasks.updated", { id: "1" });

  expect(a.send).toHaveBeenCalledTimes(1);
  expect(b.send).toHaveBeenCalledTimes(1);
  const raw = a.send.mock.calls[0]![0] as string;
  const msg = JSON.parse(raw) as { type: string; data: { id: string }; ts: string };
  expect(msg.type).toBe("pmos.tasks.tasks.updated");
  expect(msg.data).toEqual({ id: "1" });
  expect(typeof msg.ts).toBe("string");
});

test("broadcast skips closed clients", () => {
  const hub = new WsHubImpl();
  const closed = fakeSocket(3);
  hub.addClient(asWs(closed));

  hub.broadcast("pmos.agent.message_created", {});

  expect(closed.send).not.toHaveBeenCalled();
});

test("removeClient stops further broadcasts", () => {
  const hub = new WsHubImpl();
  const s = fakeSocket();
  hub.addClient(asWs(s));
  hub.removeClient(asWs(s));

  hub.broadcast("pmos.calendar.meetings.updated", {});

  expect(s.send).not.toHaveBeenCalled();
  expect(hub.size).toBe(0);
});