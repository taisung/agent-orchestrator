/**
 * Pre-flight checks for `ao start` and `ao spawn`.
 *
 * Validates runtime prerequisites before entering the main command flow,
 * giving clear errors instead of cryptic failures.
 *
 * All checks throw on failure so callers can catch and handle uniformly.
 */

import type { Runtime } from "@aoagents/ao-core";
import { exec } from "./shell.js";

/**
 * Check that tmux is installed.
 * Throws with platform-appropriate manual install instructions when missing.
 */
async function checkTmux(): Promise<void> {
  try {
    await exec("tmux", ["-V"]);
    return;
  } catch {
    // tmux not found
  }

  const hint =
    process.platform === "darwin"
      ? "brew install tmux"
      : process.platform === "win32"
        ? "tmux is not available on Windows. Use WSL: wsl --install, then: sudo apt install tmux"
        : "sudo apt install tmux (Debian/Ubuntu) or sudo dnf install tmux (Fedora)";
  throw new Error(`tmux is not installed. Install it: ${hint}`);
}

/**
 * Check that a herdr server is reachable.
 *
 * Unlike tmux, having the binary is not enough — herdr is a client to a
 * long-running server, and every runtime call fails opaquely without one.
 * Distinguishes "not installed" from "installed but no server" because the
 * fixes are completely different.
 */
async function checkHerdr(): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await exec("herdr", ["status", "server"]));
  } catch {
    throw new Error(
      "herdr is not installed. Install it from https://herdr.dev, then start a server with: herdr server",
    );
  }

  if (!/status:\s*running/.test(stdout)) {
    throw new Error(
      "herdr is installed but no server is running. Start one with: herdr server " +
        "(or launch `herdr` for an interactive session).",
    );
  }
}

/**
 * Check that the GitHub CLI is installed and authenticated.
 * Distinguishes between "not installed" and "not authenticated"
 * so the user gets the right troubleshooting guidance.
 */
async function checkGhAuth(): Promise<void> {
  try {
    await exec("gh", ["--version"]);
  } catch {
    throw new Error("GitHub CLI (gh) is not installed. Install it: https://cli.github.com/");
  }

  try {
    await exec("gh", ["auth", "status"]);
  } catch {
    throw new Error("GitHub CLI is not authenticated. Run: gh auth login");
  }
}

/**
 * Herdr fit-2 (design r11 5.3.6): the readiness of the project's selected
 * runtime, before `ao start` creates an orchestrator and before `ao spawn`.
 * tmux: `checkTmux()`. Another runtime answers through its own
 * `preflight()` when it has one: the herdr plugin asks its own binary and
 * endpoint, not the ambient `herdr` on PATH that `checkHerdr()` asks.
 * `runtime` is the registry's instance, the one that the session manager
 * uses.
 */
async function checkSelectedRuntime(runtime: Runtime | null, name: string): Promise<void> {
  if (name === "tmux") {
    await checkTmux();
    return;
  }
  await runtime?.preflight?.();
}

export const preflight = {
  checkTmux,
  checkHerdr,
  checkSelectedRuntime,
  checkGhAuth,
};
