import { handleHealth } from "./routes/health";

const worker: ExportedHandler = {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health") {
      return handleHealth();
    }
    return new Response("Not found", { status: 404 });
  },
};

// Workers requires the handler as the module's default export (see the
// src/index.ts carve-out in eslint.config.ts).
export default worker;
