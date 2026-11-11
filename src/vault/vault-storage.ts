// Where the vault keeps its one sealed record. The Durable Object passes its own storage;
// tests pass a fake whose writes can fail, to reach the storage-failure paths.
export interface VaultStorage {
  get(): Promise<string | undefined>;
  put(sealed: string): Promise<void>;
  delete(): Promise<void>;
}
