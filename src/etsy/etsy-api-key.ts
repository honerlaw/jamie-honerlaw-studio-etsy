// Etsy rejects a bare keystring with a 403: every request needs `keystring:shared_secret`.
export function etsyApiKey(env: Pick<Env, "ETSY_KEYSTRING" | "ETSY_SHARED_SECRET">): string {
  return `${env.ETSY_KEYSTRING}:${env.ETSY_SHARED_SECRET}`;
}
