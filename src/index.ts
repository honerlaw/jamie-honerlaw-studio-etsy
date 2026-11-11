import { handleRequest } from "./auth/handle-request";

export { OneTimeStore } from "./storage/one-time-store";
export { EtsyTokenVault } from "./vault/etsy-token-vault";

// Workers requires the handler as the module's default export (see the carve-out in
// eslint.config.ts). The Durable Object classes must be exported from here too.
export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
