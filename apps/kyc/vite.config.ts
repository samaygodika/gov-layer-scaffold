import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The UI is a separate dev server; /api is proxied to the Fastify app so the
 * dev-actor cookie and header travel on the same origin as the page.
 *
 * The key is the regex `^/api/`, not the prefix `/api`: a prefix also matches
 * the UI's own module request for `ui/api.ts`, which the API answers with a 404
 * and the page never boots.
 */
export default defineConfig({
  root: "ui",
  server: {
    port: 5173,
    proxy: { "^/api/": { target: `http://127.0.0.1:${process.env.PORT ?? 3000}`, changeOrigin: true } },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
