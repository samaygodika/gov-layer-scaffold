/** npm run dev -w apps/kyc — the API the Vite dev server proxies to. */
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const server = createApp();
const address = await server.listen({ port });
console.log(`kyc api on ${address}`);
