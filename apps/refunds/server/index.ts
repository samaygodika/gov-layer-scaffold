import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const server = createApp();
await server.listen({ port, host: "127.0.0.1" });
console.log(`refunds server listening on http://127.0.0.1:${port}`);
