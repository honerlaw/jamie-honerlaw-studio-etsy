import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { PromptInput } from "../../scripts/bootstrap/prompt.ts";
import { terminalPrompter } from "../../scripts/bootstrap/prompt.ts";

class FakeInput extends EventEmitter implements PromptInput {
  readonly modes: boolean[] = [];
  paused = 0;
  readonly isTTY: boolean;
  constructor(isTTY: boolean) {
    super();
    this.isTTY = isTTY;
  }
  setRawMode = (mode: boolean): void => {
    this.modes.push(mode);
  };
  resume = (): void => undefined;
  pause = (): void => {
    this.paused += 1;
  };
}

function setup(isTTY = true) {
  const input = new FakeInput(isTTY);
  const written: string[] = [];
  const prompter = terminalPrompter(input, { write: (text: string) => written.push(text) });
  return { input, written, prompter };
}

describe("terminalPrompter", () => {
  it("reads a hidden value in raw mode, handling backspace, and restores the terminal", async () => {
    const { input, written, prompter } = setup();
    const answer = prompter.secret("Token");
    input.emit("data", Buffer.from(" abX\u007fc"));
    input.emit("data", "d\bd\r");
    expect(await answer).toBe("abcd");
    expect(input.modes).toStrictEqual([true, false]);
    expect(input.paused).toBe(1);
    expect(written).toStrictEqual(["Token (hidden): ", "\n"]);
    expect(input.listenerCount("data")).toBe(0);
  });

  it("leaves echo alone for a visible prompt and off a TTY", async () => {
    const visible = setup();
    const answer = visible.prompter.visible("Account");
    visible.input.emit("data", "acct  \n");
    expect(await answer).toBe("acct");
    expect(visible.input.modes).toStrictEqual([]);
    expect(visible.written).toStrictEqual(["Account: "]);

    const piped = setup(false);
    const secret = piped.prompter.secret("Token");
    piped.input.emit("data", "s\n");
    expect(await secret).toBe("s");
    expect(piped.input.modes).toStrictEqual([]);
  });

  it("rejects on Ctrl-C and still restores the terminal", async () => {
    const { input, prompter } = setup();
    const answer = prompter.secret("Token");
    input.emit("data", "ab\u0003");
    await expect(answer).rejects.toThrow("Cancelled.");
    expect(input.modes).toStrictEqual([true, false]);
  });
});
