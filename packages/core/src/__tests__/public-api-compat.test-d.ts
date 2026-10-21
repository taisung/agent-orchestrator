/**
 * Round 8 of the killed-status fix (review r6, M-3): the optional ownership
 * checks of `Workspace.destroy` (`stillOwned`) and
 * `PreparedAgentSession.discard` (`stillUnheld`) keep the public API
 * compatible: an older plugin and an older caller compile unchanged.
 * `pnpm typecheck` compiles this file, with no cast and no
 * `@ts-expect-error`. Vitest does not run it (a `.test-d.ts` file), and the
 * build leaves out `src/__tests__`.
 */
import type { PreparedAgentSession, Workspace } from "../types.js";

// The fixture of review r6, M-3, unchanged.
const legacyDestroy = async (_path: string): Promise<void> => {};
const legacyPlugin: Pick<Workspace, "destroy"> = { destroy: legacyDestroy };
declare const currentPlugin: Workspace;
const oldCaller: (path: string) => Promise<void> = currentPlugin.destroy;

// A legacy prepared session: `discard` with no parameter, `Promise<void>`.
const legacyDiscard = async (): Promise<void> => {};
const legacyPrepared: PreparedAgentSession = {
  metadata: {},
  agentConfig: {},
  created: true,
  discard: legacyDiscard,
};
declare const currentPrepared: PreparedAgentSession;
const oldDiscardCaller: () => Promise<void> = currentPrepared.discard;

export const compatibilityFixtures = [legacyPlugin, oldCaller, legacyPrepared, oldDiscardCaller];
