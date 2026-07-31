import { buildApp } from "./dist/app.js";
const app = await buildApp();
await app.listen({ port: 0, host: "127.0.0.1" });
const r = await app.inject({ method: "POST", url: "/api/tasks/v1/tasks", payload: { title: "dbg", priority: 3 } });
console.log("status", r.statusCode);
console.log("body", r.body);
await app.close();
