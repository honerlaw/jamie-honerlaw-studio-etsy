/** Liveness probe: proves the Worker deployed and can answer a request. */
export function handleHealth(): Response {
  return Response.json({ ok: true });
}
