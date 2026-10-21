/**
 * Same-ID R2a: `stopRuntime` (design r2 section 2.6). With `Runtime.stop`,
 * its answer; a rejection or a malformed answer is `unknown`. Without it,
 * `destroy` then `isAlive`: resolved and rejected destroy crossed with
 * true, false, rejected (probe error and no server) and malformed isAlive.
 */
import { describe, it, expect, vi } from "vitest";
import {
  isRuntimeStopConfirmed,
  isRuntimeStopUnconfirmedError,
  RuntimeStopUnconfirmedError,
  RUNTIME_STOP_UNCONFIRMED_ERROR_CODE,
  RUNTIME_STOP_UNREADABLE_DETAIL,
  stopRuntime,
} from "../runtime-stop.js";
import {
  RUNTIME_NO_SERVER_ERROR_CODE,
  type Runtime,
  type RuntimeHandle,
  type RuntimeStopOutcome,
} from "../types.js";

const HANDLE: RuntimeHandle = { id: "hash-app-1", runtimeName: "tmux", data: {} };

function probeError(): Error {
  return Object.assign(new Error("tmux could not answer: timed out"), {
    code: "ERR_RUNTIME_PROBE",
  });
}

function noServerError(): Error {
  return Object.assign(new Error("no server running on /tmp/tmux-1000/default"), {
    code: RUNTIME_NO_SERVER_ERROR_CODE,
  });
}

function runtimeWith(parts: Partial<Runtime>): Runtime {
  return {
    name: "tmux",
    create: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    getOutput: vi.fn(),
    isAlive: vi.fn().mockResolvedValue(false),
    ...parts,
  };
}

type DestroyMode = "resolves" | "rejects";
type AliveMode = "false" | "true" | "probe error" | "no server" | "malformed";

function fallbackRuntime(destroy: DestroyMode, alive: AliveMode): Runtime {
  const destroyError = new Error("kill-session failed: server exited unexpectedly");
  return runtimeWith({
    destroy:
      destroy === "resolves"
        ? vi.fn().mockResolvedValue(undefined)
        : vi.fn().mockRejectedValue(destroyError),
    isAlive: vi.fn(async () => {
      switch (alive) {
        case "false":
          return false;
        case "true":
          return true;
        case "probe error":
          throw probeError();
        case "no server":
          throw noServerError();
        case "malformed":
          return "yes" as unknown as boolean;
      }
    }),
  });
}

describe("stopRuntime without Runtime.stop: destroy, then isAlive", () => {
  const table: Array<[DestroyMode, AliveMode, RuntimeStopOutcome["outcome"]]> = [
    ["resolves", "false", "destroyed"],
    ["resolves", "true", "unknown"],
    ["resolves", "probe error", "unknown"],
    // The one row beyond design r2: tmux ends a server with its last session.
    ["resolves", "no server", "destroyed"],
    ["resolves", "malformed", "unknown"],
    ["rejects", "false", "absent"],
    ["rejects", "true", "unknown"],
    ["rejects", "probe error", "unknown"],
    // A server whose socket is gone still runs its sessions (design r2 B-5).
    ["rejects", "no server", "unknown"],
    ["rejects", "malformed", "unknown"],
  ];

  for (const [destroy, alive, expected] of table) {
    it(`destroy ${destroy}, isAlive ${alive}: ${expected}`, async () => {
      const runtime = fallbackRuntime(destroy, alive);

      const stopped = await stopRuntime(runtime, HANDLE);

      expect(stopped.outcome).toBe(expected);
      expect(runtime.destroy).toHaveBeenCalledTimes(1);
      expect(runtime.destroy).toHaveBeenCalledWith(HANDLE);
      expect(runtime.isAlive).toHaveBeenCalledTimes(1);
      expect(runtime.isAlive).toHaveBeenCalledWith(HANDLE);
      expect(isRuntimeStopConfirmed(stopped)).toBe(expected !== "unknown");
    });
  }

  it("absent names what the runtime answered and the destroy failure", async () => {
    const stopped = await stopRuntime(fallbackRuntime("rejects", "false"), HANDLE);
    expect(stopped).toEqual({
      outcome: "absent",
      evidence: expect.stringContaining("tmux answered that hash-app-1 does not exist"),
    });
    expect(stopped).toMatchObject({
      evidence: expect.stringContaining("server exited unexpectedly"),
    });
  });

  it("unknown after a live answer says that the session still runs", async () => {
    const stopped = await stopRuntime(fallbackRuntime("resolves", "true"), HANDLE);
    expect(stopped).toMatchObject({
      outcome: "unknown",
      detail: "the destroy of tmux session hash-app-1 completed, but the session still runs",
    });
  });

  it("unknown after a probe error keeps the error as cause", async () => {
    const error = probeError();
    const runtime = runtimeWith({ isAlive: vi.fn().mockRejectedValue(error) });

    const stopped = await stopRuntime(runtime, HANDLE);

    expect(stopped).toMatchObject({ outcome: "unknown", cause: error });
    expect(stopped).toMatchObject({ detail: expect.stringContaining("the liveness check failed") });
  });

  it("unknown after a failed destroy and a failed probe keeps both errors", async () => {
    const destroyError = new Error("destroy failed");
    const aliveError = probeError();
    const runtime = runtimeWith({
      destroy: vi.fn().mockRejectedValue(destroyError),
      isAlive: vi.fn().mockRejectedValue(aliveError),
    });

    const stopped = await stopRuntime(runtime, HANDLE);

    expect(stopped.outcome).toBe("unknown");
    const cause = (stopped as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(AggregateError);
    expect((cause as AggregateError).errors).toEqual([destroyError, aliveError]);
  });

  it("unknown after no server and a failed destroy says that nothing can confirm the stop", async () => {
    const stopped = await stopRuntime(fallbackRuntime("rejects", "no server"), HANDLE);
    expect(stopped).toMatchObject({
      outcome: "unknown",
      detail: expect.stringContaining("no tmux server answers"),
    });
  });

  it("never rejects, also when destroy and isAlive throw synchronously", async () => {
    const runtime = runtimeWith({
      destroy: (() => {
        throw new Error("sync destroy");
      }) as Runtime["destroy"],
      isAlive: (() => {
        throw new Error("sync isAlive");
      }) as Runtime["isAlive"],
    });

    await expect(stopRuntime(runtime, HANDLE)).resolves.toMatchObject({ outcome: "unknown" });
  });
});

describe("stopRuntime with Runtime.stop", () => {
  const answers: RuntimeStopOutcome[] = [
    { outcome: "destroyed" },
    { outcome: "absent", evidence: "the recorded server said: can't find session" },
    { outcome: "other-launch", detail: "the address now names launch 7" },
    { outcome: "unknown", detail: "the server did not answer", cause: new Error("timeout") },
  ];

  for (const answer of answers) {
    it(`answers ${answer.outcome} as the plugin answered it, and calls neither destroy nor isAlive`, async () => {
      const runtime = runtimeWith({ stop: vi.fn().mockResolvedValue(answer) });

      const stopped = await stopRuntime(runtime, HANDLE);

      expect(stopped).toEqual(answer);
      expect(runtime.stop).toHaveBeenCalledWith(HANDLE);
      expect(runtime.destroy).not.toHaveBeenCalled();
      expect(runtime.isAlive).not.toHaveBeenCalled();
      expect(isRuntimeStopConfirmed(stopped)).toBe(
        answer.outcome === "destroyed" || answer.outcome === "absent",
      );
    });
  }

  it("a stop that rejects gives unknown with the rejection as cause", async () => {
    const error = new Error("herdr: connection refused");
    const runtime = runtimeWith({ stop: vi.fn().mockRejectedValue(error) });

    const stopped = await stopRuntime(runtime, HANDLE);

    expect(stopped).toEqual({
      outcome: "unknown",
      detail: "the stop of tmux session hash-app-1 failed: herdr: connection refused",
      cause: error,
    });
    expect(runtime.destroy).not.toHaveBeenCalled();
  });

  const malformed: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["a string", "destroyed"],
    ["an unknown outcome", { outcome: "gone" }],
    ["absent without evidence", { outcome: "absent" }],
    ["absent with empty evidence", { outcome: "absent", evidence: "  " }],
    ["other-launch without detail", { outcome: "other-launch" }],
    ["unknown without detail", { outcome: "unknown" }],
    ["a detail that is not a string", { outcome: "other-launch", detail: 7 }],
  ];

  for (const [label, value] of malformed) {
    it(`a stop that answers ${label} gives unknown, never a confirmed stop`, async () => {
      const runtime = runtimeWith({ stop: vi.fn().mockResolvedValue(value) });

      const stopped = await stopRuntime(runtime, HANDLE);

      expect(stopped.outcome).toBe("unknown");
      expect(stopped).toMatchObject({
        detail: expect.stringContaining("answered a value that is not a stop outcome"),
      });
      expect(isRuntimeStopConfirmed(stopped)).toBe(false);
      expect(runtime.destroy).not.toHaveBeenCalled();
    });
  }

  it("keeps only the known fields of a valid answer", async () => {
    const runtime = runtimeWith({
      stop: vi.fn().mockResolvedValue({ outcome: "absent", evidence: "gone", extra: "x" }),
    });
    await expect(stopRuntime(runtime, HANDLE)).resolves.toEqual({
      outcome: "absent",
      evidence: "gone",
    });
  });
});

describe("stopRuntime never rejects, also for a plugin answer that AO cannot read (review r1, m-1)", () => {
  /** A thrown value that String() cannot convert: no prototype, so no toString. */
  function nullPrototypeError(): unknown {
    return Object.create(null) as unknown;
  }

  it("a stop that throws a null-prototype object gives unknown, with that object as cause", async () => {
    const thrown = nullPrototypeError();
    const runtime = runtimeWith({
      stop: async () => {
        throw thrown;
      },
    });

    const stopped = await stopRuntime(runtime, HANDLE);

    expect(stopped).toEqual({
      outcome: "unknown",
      detail: "the stop of tmux session hash-app-1 failed: a value that cannot be shown as text",
      cause: thrown,
    });
    expect(isRuntimeStopConfirmed(stopped)).toBe(false);
  });

  for (const alive of [true, false]) {
    it(`a fallback destroy that throws a null-prototype object, isAlive ${alive}: the table applies`, async () => {
      const thrown = nullPrototypeError();
      const runtime = runtimeWith({
        destroy: async () => {
          throw thrown;
        },
        isAlive: vi.fn().mockResolvedValue(alive),
      });

      const stopped = await stopRuntime(runtime, HANDLE);

      expect(stopped).toMatchObject(
        alive
          ? {
              outcome: "unknown",
              detail:
                "the destroy of tmux session hash-app-1 failed (a value that cannot be shown as text), but the session still runs",
              cause: thrown,
            }
          : {
              outcome: "absent",
              evidence: expect.stringContaining("failed (a value that cannot be shown as text)"),
            },
      );
    });
  }

  it("an isAlive that throws a null-prototype object gives unknown", async () => {
    const thrown = nullPrototypeError();
    const runtime = runtimeWith({
      isAlive: async () => {
        throw thrown;
      },
    });

    await expect(stopRuntime(runtime, HANDLE)).resolves.toMatchObject({
      outcome: "unknown",
      detail: expect.stringContaining(
        "the liveness check failed (a value that cannot be shown as text)",
      ),
      cause: thrown,
    });
  });

  it("an isAlive rejection whose code getter throws is no proof that no server runs", async () => {
    const thrown = Object.defineProperty(new Error("probe failed"), "code", {
      get() {
        throw new Error("broken code getter");
      },
    });
    const runtime = runtimeWith({ isAlive: vi.fn().mockRejectedValue(thrown) });

    await expect(stopRuntime(runtime, HANDLE)).resolves.toMatchObject({
      outcome: "unknown",
      detail: expect.stringContaining("the liveness check failed (probe failed)"),
    });
  });

  it("an answer whose outcome getter throws gives unknown with the constant detail", async () => {
    const getterError = new Error("broken outcome getter");
    const answer = Object.defineProperty({}, "outcome", {
      get() {
        throw getterError;
      },
    });
    const runtime = runtimeWith({ stop: vi.fn().mockResolvedValue(answer) });

    const stopped = await stopRuntime(runtime, HANDLE);

    expect(stopped).toEqual({
      outcome: "unknown",
      detail: RUNTIME_STOP_UNREADABLE_DETAIL,
      cause: getterError,
    });
    expect(runtime.destroy).not.toHaveBeenCalled();
  });

  it("an answer whose detail getter throws gives unknown with the constant detail", async () => {
    const answer = Object.defineProperty({ outcome: "unknown" }, "detail", {
      get() {
        throw new Error("broken detail getter");
      },
    });
    const runtime = runtimeWith({ stop: vi.fn().mockResolvedValue(answer) });

    await expect(stopRuntime(runtime, HANDLE)).resolves.toMatchObject({
      outcome: "unknown",
      detail: RUNTIME_STOP_UNREADABLE_DETAIL,
    });
  });

  it("a stop getter that throws gives unknown with the constant detail, and calls nothing", async () => {
    const getterError = new Error("broken stop getter");
    const runtime = runtimeWith({});
    Object.defineProperty(runtime, "stop", {
      get() {
        throw getterError;
      },
    });

    const stopped = await stopRuntime(runtime, HANDLE);

    expect(stopped).toEqual({
      outcome: "unknown",
      detail: RUNTIME_STOP_UNREADABLE_DETAIL,
      cause: getterError,
    });
    expect(runtime.destroy).not.toHaveBeenCalled();
    expect(runtime.isAlive).not.toHaveBeenCalled();
  });

  it("an unshowable answer value still gives the not-a-stop-outcome detail", async () => {
    const answer = Object.create(null) as unknown;
    const runtime = runtimeWith({ stop: vi.fn().mockResolvedValue(answer) });

    await expect(stopRuntime(runtime, HANDLE)).resolves.toMatchObject({
      outcome: "unknown",
      detail: expect.stringContaining("answered a value that is not a stop outcome: {}"),
    });
  });

  it("a constant detail that names nothing from the plugin", () => {
    expect(RUNTIME_STOP_UNREADABLE_DETAIL).toBe(
      "AO could not read the runtime plugin or its answer to the stop (a property or a value threw), so nothing confirms that the session stopped",
    );
  });
});

describe("the next action of a runtime that a retry cannot help", () => {
  it("a stop answer keeps a non-empty next, and drops one that is not a string", async () => {
    const withNext = runtimeWith({
      stop: vi.fn().mockResolvedValue({
        outcome: "unknown",
        detail: "cannot stop yet",
        next: "Close it by hand.",
      }),
    });
    const badNext = runtimeWith({
      stop: vi.fn().mockResolvedValue({ outcome: "other-launch", detail: "moved", next: 7 }),
    });

    await expect(stopRuntime(withNext, HANDLE)).resolves.toEqual({
      outcome: "unknown",
      detail: "cannot stop yet",
      next: "Close it by hand.",
    });
    await expect(stopRuntime(badNext, HANDLE)).resolves.toEqual({
      outcome: "other-launch",
      detail: "moved",
    });
  });

  it("the error uses next as its hint, also through hintFor, and names no retry", () => {
    const err = new RuntimeStopUnconfirmedError({
      sessionId: "app-1",
      handle: HANDLE,
      stop: { outcome: "unknown", detail: "cannot stop yet", next: "Close it by hand." },
      kept: "record and worktree kept",
      retry: "ao session kill app-1",
    });

    expect(err.hint).toBe("Close it by hand.");
    expect(err.hintFor("ao stop my-app")).toBe("Close it by hand.");
  });

  it("hintFor names another command to try again", () => {
    const err = new RuntimeStopUnconfirmedError({
      sessionId: "app-orchestrator",
      handle: HANDLE,
      stop: { outcome: "unknown", detail: "the server did not answer" },
      kept: "record and worktree kept",
      retry: "ao session kill app-orchestrator",
    });

    expect(err.hint).toContain("`ao session kill app-orchestrator`");
    expect(err.hintFor("ao stop my-app")).toContain("then run `ao stop my-app` again");
    expect(err.hintFor("ao stop my-app")).not.toContain("ao session kill");
  });
});

describe("RuntimeStopUnconfirmedError", () => {
  it("names the outcome, the detail, what was kept, and the next action", () => {
    const cause = new Error("timeout");
    const err = new RuntimeStopUnconfirmedError({
      sessionId: "app-1",
      handle: HANDLE,
      stop: { outcome: "unknown", detail: "the server did not answer", cause },
      kept: "record and worktree kept",
      retry: "ao session kill app-1",
    });

    expect(err.message).toBe(
      "runtime stop unconfirmed (unknown): the server did not answer; record and worktree kept",
    );
    expect(err.outcome).toBe("unknown");
    expect(err.detail).toBe("the server did not answer");
    expect(err.code).toBe(RUNTIME_STOP_UNCONFIRMED_ERROR_CODE);
    expect(err.cause).toBe(cause);
    expect(err.hint).toContain("Check tmux session hash-app-1 by hand");
    expect(err.hint).toContain("`ao session kill app-1`");
    expect(isRuntimeStopUnconfirmedError(err)).toBe(true);
  });

  it("is recognised by its code and hint across copies of core", () => {
    expect(
      isRuntimeStopUnconfirmedError({ code: RUNTIME_STOP_UNCONFIRMED_ERROR_CODE, hint: "h" }),
    ).toBe(true);
    expect(isRuntimeStopUnconfirmedError(new Error("other"))).toBe(false);
    expect(isRuntimeStopUnconfirmedError(null)).toBe(false);
  });
});
