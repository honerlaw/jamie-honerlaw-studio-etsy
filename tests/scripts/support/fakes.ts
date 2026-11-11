import type { CommandRunner, RunOptions, RunResult } from "../../../scripts/lib/command-runner.ts";
import type { Output } from "../../../scripts/lib/output.ts";

export interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: RunOptions;
}

export function fakeRunner(handler: (call: Call) => RunResult | Promise<RunResult>): {
  readonly run: CommandRunner;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    run: async (command, args, options) => {
      const call = { command, args, options };
      calls.push(call);
      return handler(call);
    },
  };
}

export function ok(stdout = ""): RunResult {
  return { code: 0, stdout };
}

export interface Request {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

export function fakeFetch(handler: (request: Request) => Response): {
  readonly fetch: typeof fetch;
  readonly requests: Request[];
} {
  const requests: Request[] = [];
  const fetchFn = (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> => {
    const request: Request = {
      url: input instanceof URL ? input.href : typeof input === "string" ? input : input.url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    requests.push(request);
    return Promise.resolve(handler(request));
  };
  return { fetch: fetchFn, requests };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function captureOutput(): Output & { readonly lines: string[]; readonly errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    line: (text) => {
      lines.push(text);
    },
    error: (text) => {
      errors.push(text);
    },
  };
}

/**
 * A promise rejected with a non-Error reason, as some libraries produce.
 * `throwIfAborted` throws the abort reason as is; a plain `throw` or
 * `Promise.reject` of a non-Error is linted out.
 */
export async function rejectWith(reason: string): Promise<never> {
  await Promise.resolve();
  AbortSignal.abort(reason).throwIfAborted();
  throw new Error("unreachable: an aborted signal always throws");
}
