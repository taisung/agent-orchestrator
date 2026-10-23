/**
 * Herdr fit-2 (design r11 4.1): the typed errors and their guards. A guard
 * checks the `code` and the whole shape, never `instanceof` alone, so it
 * accepts the error of another copy of core and refuses an error that has the
 * code but not the shape.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ORCHESTRATOR_START_BLOCKED_ERROR_CODE,
  OrchestratorStartBlockedError,
  RUNTIME_CREATE_PARTIAL_ERROR_CODE,
  RUNTIME_SEND_REFUSED_ERROR_CODE,
  RuntimeCreatePartialError,
  RuntimeSendRefusedError,
  isOrchestratorStartBlockedError,
  isRuntimeCreatePartialError,
  isRuntimeSendRefusedError,
  isWellFormedHandle,
} from "../runtime-errors.js";
import type * as RuntimeErrors from "../runtime-errors.js";

// gitleaks reads a hex literal after a token key as a key; the sample is built.
const SAMPLE_IDENTITY_TOKEN = "ab".repeat(8);

const HANDLE = {
  id: "w7:p1",
  runtimeName: "herdr",
  data: { workspaceId: "w7", paneId: "w7:p1", createIncomplete: "launch-unconfirmed" },
};

type RuntimeErrorsModule = typeof RuntimeErrors;

/** A second copy of the module, as a plugin that bundles its own core has. */
async function otherCopy(): Promise<RuntimeErrorsModule> {
  vi.resetModules();
  return import("../runtime-errors.js");
}

describe("isWellFormedHandle", () => {
  it("accepts the stored shape, also with an empty ID (the pending handle)", () => {
    expect(isWellFormedHandle(HANDLE)).toBe(true);
    expect(
      isWellFormedHandle({
        id: "",
        runtimeName: "herdr",
        data: { createIncomplete: "create-pending" },
      }),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["an array", [HANDLE]],
    ["a text", JSON.stringify(HANDLE)],
    ["an ID that is not text", { ...HANDLE, id: 7 }],
    ["no runtimeName", { id: "w7:p1", data: {} }],
    ["an empty runtimeName", { ...HANDLE, runtimeName: "" }],
    ["a runtimeName that is not text", { ...HANDLE, runtimeName: ["herdr"] }],
    ["data null", { ...HANDLE, data: null }],
    ["data an array", { ...HANDLE, data: [] }],
    ["no data", { id: "w7:p1", runtimeName: "herdr" }],
  ])("refuses %s", (_label, value) => {
    expect(isWellFormedHandle(value)).toBe(false);
  });
});

describe("RuntimeCreatePartialError", () => {
  it("carries the handle, the stage, closed nothing and the cause", () => {
    const cause = new Error("pane run timed out");
    const err = new RuntimeCreatePartialError("Failed to launch agent in herdr pane w7:p1", {
      handle: HANDLE,
      stage: "launch-unconfirmed",
      cause,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RuntimeCreatePartialError");
    expect(err.code).toBe(RUNTIME_CREATE_PARTIAL_ERROR_CODE);
    expect(err.code).toBe("ERR_RUNTIME_CREATE_PARTIAL");
    expect(err.closed).toBe("nothing");
    expect(err.handle).toBe(HANDLE);
    expect(err.stage).toBe("launch-unconfirmed");
    expect(err.cause).toBe(cause);
    expect(err.message).toBe("Failed to launch agent in herdr pane w7:p1");
    expect(isRuntimeCreatePartialError(err)).toBe(true);
  });

  it("is accepted from another copy of the module, which instanceof does not see", async () => {
    const copy = await otherCopy();
    const err = new copy.RuntimeCreatePartialError("x", {
      handle: HANDLE,
      stage: "workspace-unconfirmed",
    });
    expect(err).not.toBeInstanceOf(RuntimeCreatePartialError);
    expect(isRuntimeCreatePartialError(err)).toBe(true);
    // A plain error with the same fields (a build without the class).
    expect(
      isRuntimeCreatePartialError(
        Object.assign(new Error("x"), {
          code: "ERR_RUNTIME_CREATE_PARTIAL",
          handle: HANDLE,
          stage: "launch-not-submitted",
          closed: "nothing",
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["another code", { code: "ERR_RUNTIME_NO_SERVER" }],
    ["no handle", { handle: undefined }],
    ["a handle without data", { handle: { id: "w7:p1", runtimeName: "herdr" } }],
    ["a handle with an empty runtimeName", { handle: { ...HANDLE, runtimeName: "" } }],
    ["an unknown stage", { stage: "launch-failed" }],
    ["no stage", { stage: undefined }],
    ["closed something", { closed: "workspace" }],
    ["no closed", { closed: undefined }],
  ])("refuses an error with %s", (_label, change) => {
    const err = Object.assign(new Error("x"), {
      code: "ERR_RUNTIME_CREATE_PARTIAL",
      handle: HANDLE,
      stage: "launch-unconfirmed",
      closed: "nothing",
      ...change,
    });
    expect(isRuntimeCreatePartialError(err)).toBe(false);
  });

  it("refuses values that are not objects", () => {
    for (const value of [null, undefined, "ERR_RUNTIME_CREATE_PARTIAL", 7]) {
      expect(isRuntimeCreatePartialError(value)).toBe(false);
    }
  });
});

describe("RuntimeSendRefusedError", () => {
  it("carries reason agent_blocked, the admission, the target and the stage", () => {
    const err = new RuntimeSendRefusedError("blocked", {
      admitted: "earlier-attempt-unconfirmed",
      target: "w7:p1",
      stage: "settle wait after attempt 1",
    });
    expect(err.name).toBe("RuntimeSendRefusedError");
    expect(err.code).toBe(RUNTIME_SEND_REFUSED_ERROR_CODE);
    expect(err.code).toBe("ERR_RUNTIME_SEND_REFUSED");
    expect(err.reason).toBe("agent_blocked");
    expect(err.admitted).toBe("earlier-attempt-unconfirmed");
    expect(err.target).toBe("w7:p1");
    expect(err.stage).toBe("settle wait after attempt 1");
    expect(isRuntimeSendRefusedError(err)).toBe(true);
  });

  it("is accepted from another copy of the module", async () => {
    const copy = await otherCopy();
    const err = new copy.RuntimeSendRefusedError("blocked", {
      admitted: "none",
      target: "w7:p1",
      stage: "first settle wait",
    });
    expect(err).not.toBeInstanceOf(RuntimeSendRefusedError);
    expect(isRuntimeSendRefusedError(err)).toBe(true);
  });

  it.each([
    ["another code", { code: "ERR_RUNTIME_CREATE_PARTIAL" }],
    ["another reason", { reason: "agent_busy" }],
    ["an unknown admission", { admitted: "unknown" }],
    ["no target", { target: undefined }],
    ["a target that is not text", { target: 1 }],
    ["no stage", { stage: undefined }],
  ])("refuses an error with %s", (_label, change) => {
    const err = Object.assign(new Error("x"), {
      code: "ERR_RUNTIME_SEND_REFUSED",
      reason: "agent_blocked",
      admitted: "none",
      target: "w7:p1",
      stage: "first settle wait",
      ...change,
    });
    expect(isRuntimeSendRefusedError(err)).toBe(false);
  });
});

describe("OrchestratorStartBlockedError", () => {
  it("carries the project, the reason and the blocking launches", () => {
    const err = new OrchestratorStartBlockedError("blocked", {
      projectId: "my-app",
      reason: "admission-path",
    });
    expect(err.name).toBe("OrchestratorStartBlockedError");
    expect(err.code).toBe(ORCHESTRATOR_START_BLOCKED_ERROR_CODE);
    expect(err.code).toBe("ERR_ORCHESTRATOR_START_BLOCKED");
    expect(err.projectId).toBe("my-app");
    expect(err.reason).toBe("admission-path");
    expect(err.blocking).toEqual([]);
    expect(isOrchestratorStartBlockedError(err)).toBe(true);
  });

  it("is accepted from another copy of the module", async () => {
    const copy = await otherCopy();
    const err = new copy.OrchestratorStartBlockedError("blocked", {
      projectId: "my-app",
      reason: "records",
      blocking: [
        {
          sessionId: "app-orchestrator",
          kind: "create-incomplete",
          reason: "its create did not finish",
          status: "working",
          launchFailed: false,
          identityToken: SAMPLE_IDENTITY_TOKEN,
        },
      ],
    });
    expect(err).not.toBeInstanceOf(OrchestratorStartBlockedError);
    expect(isOrchestratorStartBlockedError(err)).toBe(true);
  });

  it.each([
    ["another code", { code: "ERR_RUNTIME_SEND_REFUSED" }],
    ["no project", { projectId: undefined }],
    ["an unknown reason", { reason: "busy" }],
    ["blocking that is not an array", { blocking: {} }],
    ["no blocking", { blocking: undefined }],
  ])("refuses an error with %s", (_label, change) => {
    const err = Object.assign(new Error("x"), {
      code: "ERR_ORCHESTRATOR_START_BLOCKED",
      projectId: "my-app",
      reason: "records",
      blocking: [],
      ...change,
    });
    expect(isOrchestratorStartBlockedError(err)).toBe(false);
  });
});
