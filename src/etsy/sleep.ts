// Resolves after `ms` milliseconds (used between 429 retries).
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
