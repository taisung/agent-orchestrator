import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExecFile = vi.fn();
const mockExecFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

vi.mock("node:util", () => ({
  promisify:
    (_fn: unknown) =>
    (...args: any[]) =>
      mockExecFile(...args),
}));

vi.mock("node:fs", () => ({
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
}));

vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
}));

const { manifest, create, detect } = await import("../index.js");

/** herdr answers `{id, result}` on success and `{error}` on failure, both exit 0. */
function ok(result: unknown) {
  return { stdout: JSON.stringify({ id: "cli:test", result }), stderr: "" };
}
function herdrError(code: string, message = "boom") {
  return { stdout: JSON.stringify({ id: "cli:test", error: { code, message } }), stderr: "" };
}
function text(body: string) {
  return { stdout: body, stderr: "" };
}

const WORKSPACE_CREATED = {
  workspace: { workspace_id: "w7", label: "app-1" },
  root_pane: { pane_id: "w7:p1", terminal_id: "term_abc", workspace_id: "w7" },
};

const CREATE_CONFIG = {
  sessionId: "app-1",
  workspacePath: "/tmp/wt/app-1",
  launchCommand: "claude --model sonnet",
  environment: { AO_SESSION_ID: "app-1", AO_ISSUE_ID: "iss-9" },
};

/** The handle create() would have produced. */
const HANDLE = {
  id: "w7:p1",
  runtimeName: "herdr",
  data: {
    workspaceId: "w7",
    paneId: "w7:p1",
    terminalId: "term_abc",
    sessionId: "app-1",
    workspacePath: "/tmp/wt/app-1",
    createdAt: Date.now(),
  },
};

/** Args of the nth herdr invocation. */
function argsOf(call: number): string[] {
  return mockExecFile.mock.calls[call]?.[1] ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("manifest", () => {
  it("declares the herdr runtime slot", () => {
    expect(manifest.name).toBe("herdr");
    expect(manifest.slot).toBe("runtime");
  });
});

describe("create()", () => {
  it("returns a Runtime named herdr", () => {
    expect(create().name).toBe("herdr");
  });

  it("rejects session ids that are not shell/label safe", async () => {
    const rt = create();
    await expect(rt.create({ ...CREATE_CONFIG, sessionId: "app 1; rm -rf /" })).rejects.toThrow(
      /Invalid session ID/,
    );
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("creates the workspace with cwd, label and one --env per variable", async () => {
    mockExecFile.mockResolvedValueOnce(ok(WORKSPACE_CREATED)).mockResolvedValueOnce(ok({}));

    await create().create(CREATE_CONFIG);

    const args = argsOf(0);
    expect(args.slice(0, 2)).toEqual(["workspace", "create"]);
    expect(args).toContain("--cwd");
    expect(args[args.indexOf("--cwd") + 1]).toBe("/tmp/wt/app-1");
    expect(args[args.indexOf("--label") + 1]).toBe("app-1");
    expect(args).toContain("--no-focus");
    expect(args).toContain("AO_SESSION_ID=app-1");
    expect(args).toContain("AO_ISSUE_ID=iss-9");
  });

  it("launches via `pane run` on a script so the launch command is preserved verbatim", async () => {
    // agent start would run the bare executable and drop AO's --model flag.
    mockExecFile.mockResolvedValueOnce(ok(WORKSPACE_CREATED)).mockResolvedValueOnce(ok({}));

    await create().create(CREATE_CONFIG);

    expect(argsOf(1).slice(0, 4)).toEqual(["pane", "run", "w7:p1", "bash"]);
    expect(
      mockExecFile.mock.calls.some((c) => c[1]?.includes("agent") && c[1]?.includes("start")),
    ).toBe(false);

    const written = mockWriteFileSync.mock.calls[0];
    expect(written[1]).toContain("claude --model sonnet");
  });

  it("returns a handle keyed by pane id, carrying workspace and terminal ids", async () => {
    mockExecFile.mockResolvedValueOnce(ok(WORKSPACE_CREATED)).mockResolvedValueOnce(ok({}));

    const handle = await create().create(CREATE_CONFIG);

    expect(handle.id).toBe("w7:p1");
    expect(handle.runtimeName).toBe("herdr");
    expect(handle.data.workspaceId).toBe("w7");
    expect(handle.data.terminalId).toBe("term_abc");
  });

  it("closes the workspace when the launch fails, leaving nothing in the shared server", async () => {
    mockExecFile
      .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockResolvedValueOnce(ok({}));

    await expect(create().create(CREATE_CONFIG)).rejects.toThrow(/Failed to launch agent/);
    expect(argsOf(2)).toEqual(["workspace", "close", "w7"]);
  });

  it("surfaces a herdr error body even though the CLI exits 0", async () => {
    mockExecFile.mockResolvedValueOnce(herdrError("workspace_create_failed", "no such dir"));

    await expect(create().create(CREATE_CONFIG)).rejects.toThrow(
      /workspace_create_failed.*no such dir/,
    );
  });

  it("throws when the response carries no usable pane", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ workspace: { workspace_id: "w7" } }));

    await expect(create().create(CREATE_CONFIG)).rejects.toThrow(/no usable pane/);
  });
});

describe("destroy()", () => {
  it("closes the owned workspace, never the server", async () => {
    mockExecFile.mockResolvedValueOnce(ok({}));

    await create().destroy(HANDLE);

    expect(argsOf(0)).toEqual(["workspace", "close", "w7"]);
    expect(mockExecFile.mock.calls.some((c) => c[1]?.includes("server"))).toBe(false);
  });

  it("falls back to closing the pane when no workspace id was recorded", async () => {
    mockExecFile.mockResolvedValueOnce(ok({}));

    await create().destroy({ ...HANDLE, data: { ...HANDLE.data, workspaceId: "" } });

    expect(argsOf(0)).toEqual(["pane", "close", "w7:p1"]);
  });

  it("swallows errors when the workspace is already gone", async () => {
    mockExecFile.mockRejectedValueOnce(new Error("not found"));
    await expect(create().destroy(HANDLE)).resolves.toBeUndefined();
  });
});

describe("sendMessage()", () => {
  /** A `pane get` answer with the agent in a given state. */
  const at = (agent_status: string, agent: string | null = "claude") =>
    ok({ pane: { pane_id: "w7:p1", agent, agent_status } });

  /** Every `agent prompt` invocation, in order. */
  function promptCalls(): string[][] {
    return mockExecFile.mock.calls
      .map((c) => c[1] as string[])
      .filter((a) => a?.[0] === "agent" && a?.[1] === "prompt");
  }

  // Regression guard for 0003 §8.2: prompting before the agent settles is
  // silently dropped — the text never arrives and no error is raised.
  it("waits for a settled agent before prompting", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("unknown", null))
      .mockResolvedValueOnce(at("working"))
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // agent prompt
      .mockResolvedValue(at("working")); // consumed

    await create().sendMessage(HANDLE, "do the thing");

    expect(argsOf(0)).toEqual(["pane", "get", "w7:p1"]);
    expect(promptCalls()).toEqual([["agent", "prompt", "w7:p1", "do the thing"]]);
  });

  it("does not prompt while the agent is still working", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("working"))
      .mockResolvedValueOnce(at("done")) // settled
      .mockResolvedValueOnce(at("done")) // pre-send state
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValue(at("working"));

    await create({ settleTimeoutMs: 5_000 }).sendMessage(HANDLE, "hi");

    // Nothing was sent until the agent left `working`.
    expect(argsOf(3)).toEqual(["agent", "prompt", "w7:p1", "hi"]);
    expect(promptCalls()).toHaveLength(1);
  });

  it("treats blocked as settled — a prompt is how you answer a blocked agent", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("blocked")) // settled
      .mockResolvedValueOnce(at("blocked")) // pre-send state
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValue(at("working"));

    await create().sendMessage(HANDLE, "yes");

    expect(argsOf(2)).toEqual(["agent", "prompt", "w7:p1", "yes"]);
  });

  // The multi-worker campaign finding (0004 §5): herdr reports `idle` the moment
  // it recognises the agent's prompt box, seconds before the agent can actually
  // consume input. The first prompt is swallowed with no error anywhere, so the
  // settle gate alone is not enough — delivery has to be verified and re-sent.
  it("re-sends when the first prompt is silently swallowed", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // prompt #1
      .mockResolvedValueOnce(at("idle")) // still idle — swallowed
      .mockResolvedValueOnce(at("idle")) // re-settle
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // prompt #2
      .mockResolvedValue(at("working")); // consumed

    await create({ deliveryTimeoutMs: 0 }).sendMessage(HANDLE, "retry me");

    expect(promptCalls()).toEqual([
      ["agent", "prompt", "w7:p1", "retry me"],
      ["agent", "prompt", "w7:p1", "retry me"],
    ]);
  });

  it("throws rather than reporting success when nothing ever consumes the message", async () => {
    mockExecFile.mockResolvedValue(at("idle"));

    await expect(
      create({ deliveryTimeoutMs: 0, sendAttempts: 2 }).sendMessage(HANDLE, "into the void"),
    ).rejects.toThrow(/did not consume the message/);

    expect(promptCalls()).toHaveLength(2);
    expect(mockExecFile.mock.calls.map((c) => c[1])).toContainEqual([
      "pane",
      "send-text",
      "w7:p1",
      "into the void",
    ]);
  });

  it("accepts the raw terminal fallback when it visibly lands", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // prompt
      .mockResolvedValueOnce(at("idle")) // swallowed
      .mockResolvedValueOnce(at("idle")) // re-settle
      .mockResolvedValueOnce(ok({})) // send-text
      .mockResolvedValueOnce(ok({})) // send-keys Enter
      .mockResolvedValue(at("working")); // the fallback landed

    await expect(
      create({ deliveryTimeoutMs: 0, sendAttempts: 1 }).sendMessage(HANDLE, "plain"),
    ).resolves.toBeUndefined();
  });

  it("falls back to raw terminal input when no agent is ever detected", async () => {
    mockExecFile.mockResolvedValue(at("unknown", null));

    await create({ settleTimeoutMs: 0 }).sendMessage(HANDLE, "plain text");

    const sent = mockExecFile.mock.calls.map((c) => c[1]);
    expect(sent).toContainEqual(["pane", "send-text", "w7:p1", "plain text"]);
    expect(sent).toContainEqual(["pane", "send-keys", "w7:p1", "Enter"]);
  });

  it("never passes --wait, which does not track turns", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle"))
      .mockResolvedValueOnce(at("idle"))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValue(at("working"));

    await create().sendMessage(HANDLE, "hi");

    expect(mockExecFile.mock.calls.every((c) => !c[1]?.includes("--wait"))).toBe(true);
  });
});

describe("getOutput()", () => {
  it("reads recent-unwrapped so alt-screen TUI scrollback is reachable", async () => {
    mockExecFile.mockResolvedValueOnce(text("SPIKE-1\nSPIKE-2\n"));

    const out = await create().getOutput(HANDLE, 120);

    expect(argsOf(0)).toEqual([
      "pane",
      "read",
      "w7:p1",
      "--source",
      "recent-unwrapped",
      "--lines",
      "120",
    ]);
    expect(out).toBe("SPIKE-1\nSPIKE-2");
  });

  it("falls back to visible when recent-unwrapped is empty (pane with no agent)", async () => {
    mockExecFile
      .mockResolvedValueOnce(text("   \n  "))
      .mockResolvedValueOnce(text("$ echo hi\nhi"));

    const out = await create().getOutput(HANDLE);

    expect(argsOf(1)).toContain("visible");
    expect(out).toBe("$ echo hi\nhi");
  });

  it("falls back to visible when recent-unwrapped errors", async () => {
    mockExecFile
      .mockRejectedValueOnce(new Error("bad source"))
      .mockResolvedValueOnce(text("shell"));

    expect(await create().getOutput(HANDLE)).toBe("shell");
  });

  it("returns empty string when the pane cannot be read at all", async () => {
    mockExecFile.mockRejectedValue(new Error("gone"));
    expect(await create().getOutput(HANDLE)).toBe("");
  });

  it("defaults to 50 lines", async () => {
    mockExecFile.mockResolvedValueOnce(text("x"));
    await create().getOutput(HANDLE);
    expect(argsOf(0)).toContain("50");
  });
});

describe("isAlive()", () => {
  it("is true when the pane exists with the expected terminal", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1", terminal_id: "term_abc" } }));
    expect(await create().isAlive(HANDLE)).toBe(true);
  });

  it("is false when the pane is gone", async () => {
    mockExecFile.mockRejectedValueOnce(new Error("pane_not_found"));
    expect(await create().isAlive(HANDLE)).toBe(false);
  });

  it("is false when the pane id was recycled onto a different terminal", async () => {
    // Pane ids are positional and reused after a workspace closes; without this
    // guard a new session's pane would report the old session as alive.
    mockExecFile.mockResolvedValueOnce(
      ok({ pane: { pane_id: "w7:p1", terminal_id: "term_someone_else" } }),
    );
    expect(await create().isAlive(HANDLE)).toBe(false);
  });

  it("is true when no terminal id was recorded and cannot be compared", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1" } }));
    expect(await create().isAlive({ ...HANDLE, data: { ...HANDLE.data, terminalId: "" } })).toBe(
      true,
    );
  });
});

describe("getMetrics() / getAttachInfo()", () => {
  it("reports uptime from creation time", async () => {
    const handle = { ...HANDLE, data: { ...HANDLE.data, createdAt: Date.now() - 5_000 } };
    const metrics = await create().getMetrics!(handle);
    expect(metrics.uptimeMs).toBeGreaterThanOrEqual(5_000);
  });

  it("gives the herdr attach invocation", async () => {
    const info = await create().getAttachInfo!(HANDLE);
    expect(info.target).toBe("w7:p1");
    expect(info.command).toBe("herdr agent attach w7:p1");
  });
});

describe("config", () => {
  it("honours a custom binPath", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1" } }));
    await create({ binPath: "/opt/herdr/bin/herdr" }).isAlive(HANDLE);
    expect(mockExecFile.mock.calls[0][0]).toBe("/opt/herdr/bin/herdr");
  });

  it("defaults to herdr on PATH", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1" } }));
    await create().isAlive(HANDLE);
    expect(mockExecFile.mock.calls[0][0]).toBe("herdr");
  });
});

describe("detect()", () => {
  it("is true only when a server is running", () => {
    mockExecFileSync.mockReturnValueOnce("status: running\nversion: 0.8.0\n");
    expect(detect()).toBe(true);
  });

  it("is false when the binary exists but no server is up", () => {
    mockExecFileSync.mockReturnValueOnce("status: not running\n");
    expect(detect()).toBe(false);
  });

  it("is false when herdr is not installed", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(detect()).toBe(false);
  });
});
