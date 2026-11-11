import { buildProvider } from "./auth/build-provider";

export { OneTimeStore } from "./storage/one-time-store";
export { EtsyTokenVault } from "./vault/etsy-token-vault";

// Workers requires the handler as the module's default export (see the carve-out in
// eslint.config.ts). The Durable Object classes must be exported from here too.
export default {
  fetch(request, env, ctx) {
    return buildProvider(env, new URL(request.url).origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
