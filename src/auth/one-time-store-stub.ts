import type { OneTimeStore } from "../storage/one-time-store";

// The single OneTimeStore instance. One instance is the point: it is the one place
// where "use exactly once" can be decided.
export function oneTimeStoreStub(env: Pick<Env, "ONE_TIME_STORE">): DurableObjectStub<OneTimeStore> {
  return env.ONE_TIME_STORE.getByName("one-time-store");
}
