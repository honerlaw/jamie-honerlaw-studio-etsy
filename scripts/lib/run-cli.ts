// Entry files are one line, `await runCli(import.meta, main)`, so they hold no
// branch of their own: importing one in a test is inert (`meta.main` is false
// there) and the per-file coverage floor still holds.

export interface EntryMeta {
  readonly main: boolean;
}

export async function runCli(
  meta: EntryMeta,
  main: () => Promise<number>,
  setExitCode: (code: number) => void = (code) => {
    process.exitCode = code;
  },
): Promise<void> {
  if (!meta.main) {
    return;
  }
  setExitCode(await main());
}
