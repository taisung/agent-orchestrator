import { describe, expect, it } from "vitest";
import {
  isOrchestratorSession,
  isIssueNotFoundError,
  isLaunchEndUnproven,
  isUnprovenLaunchRecord,
  LAUNCH_END_UNPROVEN_RUNTIMES,
} from "../types.js";

describe("isOrchestratorSession", () => {
  it("detects orchestrators by explicit role metadata", () => {
    expect(
      isOrchestratorSession({ id: "app-control", metadata: { role: "orchestrator" } }, "app"),
    ).toBe(true);
  });

  it("falls back to orchestrator naming for legacy sessions", () => {
    expect(isOrchestratorSession({ id: "app-orchestrator", metadata: {} }, "app")).toBe(true);
  });

  it("detects numbered worktree orchestrators by prefix pattern", () => {
    expect(isOrchestratorSession({ id: "app-orchestrator-1", metadata: {} }, "app")).toBe(true);
    expect(isOrchestratorSession({ id: "app-orchestrator-42", metadata: {} }, "app")).toBe(true);
  });

  it("does not false-positive on worker sessions", () => {
    expect(isOrchestratorSession({ id: "app-7", metadata: { role: "worker" } }, "app")).toBe(false);
  });

  it("does not false-positive when prefix ends with -orchestrator", () => {
    // my-orchestrator-1 is a worker when prefix is "my-orchestrator"
    expect(
      isOrchestratorSession({ id: "my-orchestrator-1", metadata: {} }, "my-orchestrator"),
    ).toBe(false);
    // my-orchestrator-orchestrator-1 is the real worktree orchestrator
    expect(
      isOrchestratorSession(
        { id: "my-orchestrator-orchestrator-1", metadata: {} },
        "my-orchestrator",
      ),
    ).toBe(true);
  });
});

describe("isIssueNotFoundError", () => {
  it("matches 'Issue X not found'", () => {
    expect(isIssueNotFoundError(new Error("Issue INT-9999 not found"))).toBe(true);
  });

  it("matches 'could not resolve to an Issue'", () => {
    expect(isIssueNotFoundError(new Error("Could not resolve to an Issue"))).toBe(true);
  });

  it("matches 'no issue with identifier'", () => {
    expect(isIssueNotFoundError(new Error("No issue with identifier ABC-123"))).toBe(true);
  });

  it("matches 'invalid issue format'", () => {
    expect(isIssueNotFoundError(new Error("Invalid issue format: fix login bug"))).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isIssueNotFoundError(new Error("Unauthorized"))).toBe(false);
    expect(isIssueNotFoundError(new Error("Network timeout"))).toBe(false);
    expect(isIssueNotFoundError(new Error("API key not found"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isIssueNotFoundError(null)).toBe(false);
    expect(isIssueNotFoundError(undefined)).toBe(false);
    expect(isIssueNotFoundError("string")).toBe(false);
  });
});

describe("Herdr fit-2: the unproven set", () => {
  it("holds herdr only, by its exact name", () => {
    expect([...LAUNCH_END_UNPROVEN_RUNTIMES]).toEqual(["herdr"]);
    expect(isLaunchEndUnproven("herdr")).toBe(true);
    for (const name of ["tmux", "mock", "Herdr", "", undefined, null]) {
      expect(isLaunchEndUnproven(name), String(name)).toBe(false);
    }
  });
});

// Design r11 5.3.3, rows 1 to 3 (rows 4 and 5, a record without a handle,
// are decided apart: the predicate answers false for them).
describe("Herdr fit-2: isUnprovenLaunchRecord", () => {
  const herdrHandle = JSON.stringify({ id: "w3:p2", runtimeName: "herdr", data: {} });
  const tmuxHandle = JSON.stringify({ id: "abc-app-1", runtimeName: "tmux", data: {} });
  const record = (runtimeHandle?: string): Record<string, string> =>
    runtimeHandle === undefined ? { status: "working" } : { status: "working", runtimeHandle };

  it("rows 4 and 5: a record without a handle is false for every selected runtime", () => {
    for (const selected of ["herdr", "tmux", undefined]) {
      expect(isUnprovenLaunchRecord(record(), selected)).toBe(false);
      expect(isUnprovenLaunchRecord(record(""), selected)).toBe(false);
    }
  });

  it("row 1: a handle of the stored shape counts by its runtimeName only", () => {
    for (const selected of ["herdr", "tmux"]) {
      expect(isUnprovenLaunchRecord(record(herdrHandle), selected), selected).toBe(true);
      expect(isUnprovenLaunchRecord(record(tmuxHandle), selected), selected).toBe(false);
    }
    // The pending handle P and a partial handle are of the stored shape.
    const pending = JSON.stringify({
      id: "",
      runtimeName: "herdr",
      data: { createIncomplete: "create-pending" },
    });
    expect(isUnprovenLaunchRecord(record(pending), "tmux")).toBe(true);
  });

  it("row 2: a handle that parses without a text runtimeName counts by the selected runtime", () => {
    for (const text of [
      JSON.stringify({ id: "w3:p2", data: {} }),
      JSON.stringify({ id: "w3:p2", runtimeName: 7, data: {} }),
      JSON.stringify({ id: "w3:p2", runtimeName: "", data: {} }),
    ]) {
      expect(isUnprovenLaunchRecord(record(text), "herdr"), text).toBe(true);
      expect(isUnprovenLaunchRecord(record(text), "tmux"), text).toBe(false);
    }
  });

  it("row 3: a text that does not parse, or has the wrong shape, counts when it names herdr", () => {
    const namesHerdr = [
      '{"id":"w3:p2","runtimeName":"herdr","data":{"paneId"',
      '{"id":7,"runtimeName":"herdr","data":{}}',
      '{"id":"w3:p2","runtimeName" : "herdr","data":null}',
      '[{"runtimeName":"herdr"}]',
    ];
    for (const text of namesHerdr) {
      expect(isUnprovenLaunchRecord(record(text), "tmux"), text).toBe(true);
      expect(isUnprovenLaunchRecord(record(text), "herdr"), text).toBe(true);
    }
    const other = [
      '{"id":"abc-app-1","runtimeName":"tmux","data":',
      '{"id":"abc-app-1","runtimeName":"tmux","data":[]}',
      "null",
      "not json",
      '"herdr"',
    ];
    for (const text of other) {
      expect(isUnprovenLaunchRecord(record(text), "tmux"), text).toBe(false);
      expect(isUnprovenLaunchRecord(record(text), "herdr"), text).toBe(true);
    }
  });
});
