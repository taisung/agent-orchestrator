/**
 * Shared PATH-based workspace hooks for agent plugins that don't have
 * native hook systems (Codex, Gemini, OpenCode).
 *
 * Installs ~/.ao/bin/gh and ~/.ao/bin/git wrappers that record the PR URL of
 * `gh pr create` and the branch that HEAD names after `git checkout` or
 * `git switch` in the session metadata. Those plugins put ~/.ao/bin first in
 * the PATH of their getEnvironment, and runtime-tmux runs the tmux client
 * with that PATH so the pane gets it.
 *
 * Claude Code does not use these wrappers: its getEnvironment removes every
 * ao wrapper directory from the PATH that it inherits (removeAoBinFromPath),
 * and its PostToolUse hook is its only metadata writer.
 */
import { closeSync, openSync, readSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { writeFile, mkdir, readFile, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_PATH = "/usr/bin:/bin";
const PREFERRED_GH_BIN_DIR = "/usr/local/bin";

/** Preferred gh binary path for wrapper scripts */
export const PREFERRED_GH_PATH = `${PREFERRED_GH_BIN_DIR}/gh`;

/**
 * Get the shared bin directory for ao shell wrappers (prepended to PATH).
 * Computed lazily to avoid calling homedir() at module load time,
 * which breaks test mocks that replace homedir after import.
 */
function getAoBinDir(): string {
  return join(homedir(), ".ao", "bin");
}

/** Current version of wrapper scripts — bump when scripts change */
export const WRAPPER_VERSION = "0.2.6";

// =============================================================================
// PATH Builder
// =============================================================================

/**
 * Build a PATH string with ~/.ao/bin prepended for wrapper interception.
 * Deduplicates entries and keeps the inherited order otherwise.
 *
 * /usr/local/bin is not moved forward: the gh wrapper takes gh from GH_PATH,
 * and a promoted /usr/local/bin can shadow newer user copies of the agent
 * binaries (claude, codex, gemini) and of tmux, which runtime-tmux looks up
 * with this PATH.
 */
export function buildAgentPath(basePath: string | undefined): string {
  const inherited = (basePath ?? DEFAULT_PATH).split(":").filter(Boolean);
  const ordered: string[] = [];
  const seen = new Set<string>();

  const add = (entry: string): void => {
    if (!entry || seen.has(entry)) return;
    ordered.push(entry);
    seen.add(entry);
  };

  add(getAoBinDir());

  for (const entry of inherited) add(entry);

  return ordered.join(":");
}

/**
 * The physical path of an absolute PATH entry as the kernel resolves it: a
 * symlink is followed before a later ".." applies, so "link/.." is the parent
 * of the link's target, not the directory that holds the link. For an entry
 * that does not resolve yet (a missing directory, a dangling symlink), the
 * start that resolves is resolved and the rest is added part by part, so a
 * wrapper directory that an install creates later still matches.
 */
function physicalDir(dir: string, hops = 0): string {
  try {
    return realpathSync.native(dir);
  } catch {
    // Missing, or a symlink whose target is missing.
  }
  const parent = dirname(dir);
  if (parent === dir) return dir;
  const name = basename(dir);
  const base = physicalDir(parent, hops);
  if (name === "..") return dirname(base);
  if (name === "." || name === "") return base;
  const path = join(base, name);
  if (hops < 8) {
    try {
      const target = readlinkSync(path);
      return physicalDir(isAbsolute(target) ? target : `${base}/${target}`, hops + 1);
    } catch {
      // Not a symlink.
    }
  }
  return path;
}

/** Same header test as ao_is_real_bin in the wrappers: line 2 is "# ao <name> wrapper". */
function isAoWrapperFile(file: string, name: string): boolean {
  let fd: number | undefined;
  try {
    // A regular file only: opening a FIFO named git would block.
    if (!statSync(file).isFile()) return false;
    fd = openSync(file, "r");
    const head = Buffer.alloc(256);
    const length = readSync(fd, head, 0, head.length, 0);
    const secondLine = head.toString("utf8", 0, length).split("\n")[1] ?? "";
    return secondLine.startsWith(`# ao ${name} wrapper`);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const isAoBinPath = (dir: string): boolean =>
  basename(dir) === "bin" && basename(dirname(dir)) === ".ao";

/**
 * The entry as written ends in .ao/bin. Empty and "." parts are dropped (the
 * kernel ignores them); ".." parts stay, because only the physical path can
 * say where they lead.
 */
function namesAoBin(dir: string): boolean {
  const parts = dir.split("/").filter((part) => part !== "" && part !== ".");
  return parts.at(-1) === "bin" && parts.at(-2) === ".ao";
}

/**
 * An ao wrapper directory is the install location <some HOME>/.ao/bin, by the
 * entry's own name or by its physical path, whether the wrappers are there
 * yet or not; or any directory that holds an ao git or gh wrapper (a copy
 * elsewhere). The header test reads the physical directory, the one that a
 * command lookup through this entry reaches.
 *
 * Every directory named .ao/bin is reserved for ao, also one that holds
 * another tool's git and no ao marker. setupPathWrapperWorkspace writes the
 * wrappers into <HOME>/.ao/bin for the HOME of whichever ao process runs it,
 * and replaces a git or gh there. What a directory holds at launch time
 * cannot show that no install will fill it while the pane runs.
 */
function isAoWrapperDir(dir: string): boolean {
  if (namesAoBin(dir)) return true;
  const physical = physicalDir(dir);
  if (isAoBinPath(physical)) return true;
  return (
    isAoWrapperFile(join(physical, "git"), "git") || isAoWrapperFile(join(physical, "gh"), "gh")
  );
}

/**
 * Remove every ao wrapper directory from a PATH value, for an agent whose
 * panes must not run the wrappers (Claude Code). It matches every spelling of
 * the directory (a trailing slash, a doubled slash, a symlink, a symlink
 * followed by "..", a leading ~), the wrapper directory of another HOME, and
 * a wrapper copy elsewhere.
 *
 * It also removes every relative entry: an empty one, ".", or a name such as
 * "tools". The shell resolves such an entry against the current directory at
 * each command lookup, so after a cd it can reach a wrapper directory, and a
 * check here cannot know the pane's directory then.
 *
 * Every directory named .ao/bin is removed, also one with no ao wrapper: the
 * name is reserved for ao (see isAoWrapperDir).
 *
 * It keeps all other entries, in order, and returns the same string when it
 * removes nothing.
 */
export function removeAoBinFromPath(pathValue: string): string {
  const entries = pathValue.split(":");
  const kept = entries.filter((entry) => {
    // bash expands a leading ~ in a PATH entry. Concatenation, not join():
    // join would also collapse "..".
    const dir = entry === "~" || entry.startsWith("~/") ? `${homedir()}${entry.slice(1)}` : entry;
    return isAbsolute(dir) && !isAoWrapperDir(dir);
  });
  return kept.length === entries.length ? pathValue : kept.join(":");
}

// =============================================================================
// Shell Wrapper Scripts
// =============================================================================

/* eslint-disable no-useless-escape -- \$ escapes are intentional: bash scripts in JS template literals */

/**
 * Helper script sourced by both gh and git wrappers.
 * Provides update_ao_metadata() for writing key=value to the session file.
 */
export const AO_METADATA_HELPER = `#!/usr/bin/env bash
# ao-metadata-helper — shared by gh/git wrappers
# Provides: update_ao_metadata <key> <value> (allowed keys only: pr, status=pr_open, branch)

# m-13: branch rule, same as isSafeBranchName in core (no ref binary call here:
# this file is sourced by the wrapper named "git" that is first on PATH).
# Refuses exactly what "check-ref-format --branch" refuses (without the @{N}
# previous-checkout expansion), plus a leading "-" and the single "@".
ao_is_safe_branch() {
  local name="\$1"
  # Byte-based control check: run the [[:cntrl:]] test in the C locale so
  # that U+0080-U+009F, U+2028 and U+2029 pass, matching git and the
  # TypeScript rule. Local to this function, so the caller's LC_ALL/LANG
  # are unchanged after the sourced helper returns.
  local LC_ALL=C
  [[ -z "\$name" ]] && return 1
  [[ "\$name" == "@" || "\$name" == "HEAD" ]] && return 1
  [[ "\$name" == -* ]] && return 1
  [[ "\$name" == /* || "\$name" == */ ]] && return 1
  [[ "\$name" == *//* ]] && return 1
  [[ "\$name" == *. ]] && return 1
  case "\$name" in
    *..*) return 1 ;;
    *~*|*^*|*:*|*\\?*|*\\**|*\\[*|*\\\\*) return 1 ;;
    *@\\{*) return 1 ;;
  esac
  # Space and ASCII controls (bytes <= 0x20 and 0x7F); other bytes >= 0x80 pass.
  case "\$name" in
    *" "*) return 1 ;;
  esac
  if [[ "\$name" =~ [[:cntrl:]] ]]; then
    return 1
  fi
  local part rest="\$name"
  while true; do
    if [[ "\$rest" == */* ]]; then
      part="\${rest%%/*}"
      rest="\${rest#*/}"
    else
      part="\$rest"
      rest=""
    fi
    [[ -z "\$part" ]] && return 1
    case "\$part" in
      .*|*.lock) return 1 ;;
    esac
    [[ -z "\$rest" ]] && break
  done
  return 0
}

# m-13: pr rule, same as isSafePrUrl in core.
ao_is_safe_pr() {
  [[ "\$1" =~ ^https://github\\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/[0-9]+$ ]]
}

update_ao_metadata() {
  local key="\$1" value="\$2"
  local ao_dir="\${AO_DATA_DIR:-}"
  local ao_session="\${AO_SESSION:-}"
  local ao_state_root="\${AO_STATE_ROOT:-/__ao_state_root_unset__}"

  [[ -z "\$ao_dir" || -z "\$ao_session" ]] && return 0

  # Validate: session name must not contain path separators or traversal
  case "\$ao_session" in
    */* | *..*) return 0 ;;
  esac

  # Validate: ao_dir must be an absolute path under known ao directories or /tmp
  case "\$ao_dir" in
    "\$HOME"/.ao/* | "\$HOME"/.agent-orchestrator/* | /tmp/* | "\$ao_state_root" | "\$ao_state_root"/*) ;;
    *) return 0 ;;
  esac

  local metadata_file="\$ao_dir/\$ao_session"

  # Resolve symlinks and verify canonicalized paths are still within trusted roots
  local real_dir real_ao_dir real_state_root
  real_ao_dir="\$(cd "\$ao_dir" 2>/dev/null && pwd -P)" || return 0
  real_dir="\$(cd "\$(dirname "\$metadata_file")" 2>/dev/null && pwd -P)" || return 0
  real_state_root="\$(cd "\$ao_state_root" 2>/dev/null && pwd -P)" || real_state_root="/__ao_state_root_unset__"

  # Re-validate real_ao_dir against trusted roots after canonicalization
  # (prevents /tmp/../../home/user from escaping the allowlist)
  case "\$real_ao_dir" in
    "\$HOME"/.ao/* | "\$HOME"/.ao | "\$HOME"/.agent-orchestrator/* | "\$HOME"/.agent-orchestrator | /tmp/* | "\$real_state_root" | "\$real_state_root"/*) ;;
    *) return 0 ;;
  esac

  [[ "\$real_dir" == "\$real_ao_dir"* ]] || return 0

  [[ -f "\$metadata_file" ]] || return 0

  # Allowlist (m-10): only the keys the wrappers write. The gh wrapper writes
  # pr <url> and status pr_open on gh pr create; the git wrapper writes
  # branch <name> on checkout/switch. Core reads permissions/model/role/agent
  # from the session record for restore, so an agent that writes those keys
  # would raise its own mode. A refused call writes nothing, prints one line
  # to stderr naming the refused key, and returns non-zero. The wrappers save
  # the real binary's exit code before calling this and exit with it, and they
  # set no errexit, so a refusal can never fail the wrapped gh/git command.
  case "\$key" in
    pr|branch) ;;
    status)
      if [[ "\$value" != "pr_open" ]]; then
        echo "ao-metadata-helper: refusing status value '\$value' (only pr_open allowed)" >&2
        return 1
      fi
      ;;
    *)
      echo "ao-metadata-helper: refusing key '\$key' (allowed: pr, status, branch)" >&2
      return 1
      ;;
  esac

  # m-13: value checks, same rule as core isSafeBranchName/isSafePrUrl. A
  # refused value writes nothing, prints one line to stderr naming the key,
  # and returns non-zero. No ref-binary call here (see ao_is_safe_branch).
  if [[ "\$key" == "branch" ]]; then
    if ! ao_is_safe_branch "\$value"; then
      echo "ao-metadata-helper: refusing branch value '\$value' (not a valid branch name)" >&2
      return 1
    fi
  fi
  if [[ "\$key" == "pr" ]]; then
    if ! ao_is_safe_pr "\$value"; then
      echo "ao-metadata-helper: refusing pr value '\$value' (not a valid PR URL)" >&2
      return 1
    fi
  fi

  local temp_file="\${metadata_file}.tmp.\$\$"

  # Strip newlines from value to prevent metadata line injection
  local clean_value="\$(printf '%s' "\$value" | tr -d '\\n')"

  # Escape sed metacharacters in value (& expands to matched text, | breaks delimiter)
  local escaped_value="\$(printf '%s' "\$clean_value" | sed 's/[&|\\\\]/\\\\&/g')"

  if grep -q "^\${key}=" "\$metadata_file" 2>/dev/null; then
    sed "s|^\${key}=.*|\${key}=\${escaped_value}|" "\$metadata_file" > "\$temp_file"
  else
    cp "\$metadata_file" "\$temp_file"
    printf '%s=%s\\n' "\$key" "\$clean_value" >> "\$temp_file"
  fi

  mv "\$temp_file" "\$metadata_file"
}
`;

/**
 * Shared by the gh and git wrappers: find the real binary on PATH.
 *
 * A candidate is skipped when it is this wrapper file (the -ef identity test
 * holds for every spelling of its directory: a trailing slash, a doubled
 * slash, a symlink) or any other ao wrapper copy (another HOME or another
 * version, matched by its second-line header). So a wrapper never runs itself
 * or another wrapper, which would recurse without end. Builtins only, so the
 * search starts no extra process.
 */
const AO_FIND_REAL_BIN = `# Find the real binary: the first executable on PATH that is not an ao wrapper.
# "-ef" matches this file under any spelling of its directory, and the header
# test matches any other ao wrapper copy, so a wrapper never calls a wrapper.
ao_is_real_bin() {
  local candidate="\$1" name="\$2" header=""
  [[ -f "\$candidate" && -x "\$candidate" ]] || return 1
  [[ "\$candidate" -ef "\$0" ]] && return 1
  { IFS= read -r -n 80 header; IFS= read -r -n 80 header; } 2>/dev/null < "\$candidate"
  [[ "\$header" != "# ao \$name wrapper"* ]]
}

ao_find_real_bin() {
  local name="\$1" dir
  local -a dirs
  IFS=: read -r -a dirs <<< "\$PATH"
  for dir in "\${dirs[@]}"; do
    [[ -n "\$dir" ]] || continue
    if ao_is_real_bin "\$dir/\$name" "\$name"; then
      ao_real_bin="\$dir/\$name"
      return 0
    fi
  done
  return 1
}
`;

/**
 * gh wrapper — records the PR of `gh pr create` in the session metadata.
 * All other commands, `gh pr merge` included, run the real gh directly.
 *
 * `gh pr merge` writes nothing: "merged" is a terminal status, `--auto` only
 * queues the merge, and the PR need not be this session's. The lifecycle
 * reads the PR state from GitHub instead.
 */
export const GH_WRAPPER = `#!/usr/bin/env bash
# ao gh wrapper — auto-updates session metadata on PR operations

${AO_FIND_REAL_BIN}
# Prefer the explicit gh path from the AO environment.
real_gh=""
if [[ -n "\${GH_PATH:-}" ]] && ao_is_real_bin "\$GH_PATH" gh; then
  real_gh="\$GH_PATH"
elif ao_find_real_bin gh; then
  real_gh="\$ao_real_bin"
fi

if [[ -z "\$real_gh" ]]; then
  echo "ao-wrapper: gh not found in PATH" >&2
  exit 127
fi

# Only "gh pr create" is parsed. "gh pr merge" writes nothing: merged is a
# terminal status that the lifecycle reads from GitHub.
if [[ "\$1/\$2" != "pr/create" ]]; then
  exec "\$real_gh" "\$@"
fi

# Source the metadata helper
ao_bin_dir="\$(cd "\$(dirname "\$0")" && pwd)"
source "\$ao_bin_dir/ao-metadata-helper.sh" 2>/dev/null || true
# No-op when the helper is missing so workers see only the real gh output.
if ! command -v update_ao_metadata >/dev/null 2>&1; then
  update_ao_metadata() { return 0; }
fi

tmpout="\$(mktemp)"
trap 'rm -f "\$tmpout"' EXIT

# Only stdout goes through tee: gh prints the PR URL there. stderr stays on
# stderr, so a caller that captures stdout gets no error text in the value.
"\$real_gh" "\$@" | tee "\$tmpout"
exit_code=\${PIPESTATUS[0]}

if [[ \$exit_code -eq 0 ]]; then
  pr_url="\$(grep -Eo 'https://github\\.com/[^/]+/[^/]+/pull/[0-9]+' "\$tmpout" | head -1)"
  if [[ -n "\$pr_url" ]]; then
    update_ao_metadata pr "\$pr_url"
    update_ao_metadata status pr_open
  fi
fi

exit \$exit_code
`;

/**
 * git wrapper — records the session branch after `git checkout` and
 * `git switch`. All other commands run the real git directly.
 *
 * After a successful checkout or switch, it writes the branch that HEAD now
 * names (`git symbolic-ref -q HEAD`), or nothing when HEAD is detached. So a
 * file checkout (`git checkout -- <file>`), a detached switch and a checkout
 * of a remote-tracking ref never store a wrong name, and flags such as `-q`
 * or a global `-C <dir>` do not hide a new branch.
 *
 * It writes only when the work tree of the call is the session's own work
 * tree (the `worktree` key of the session metadata). `ao spawn` from the
 * orchestrator pane checks out the worker branch in the new worktree, and
 * that must not change the orchestrator's record.
 */
export const GIT_WRAPPER = `#!/usr/bin/env bash
# ao git wrapper — auto-updates session metadata on branch operations

${AO_FIND_REAL_BIN}
if ! ao_find_real_bin git; then
  echo "ao-wrapper: git not found in PATH" >&2
  exit 127
fi
real_git="\$ao_real_bin"

# Find the subcommand after the global options. Keep the options that select
# the repository, so the reads after the call see the same repository.
ao_sub=""
ao_repo_opts=()
ao_i=1
while [[ \$ao_i -le \$# ]]; do
  ao_arg="\${!ao_i}"
  case "\$ao_arg" in
    -C|-c|--git-dir|--work-tree|--config-env)
      ao_i=\$((ao_i + 1))
      ao_repo_opts+=("\$ao_arg" "\${!ao_i}")
      ;;
    --namespace|--super-prefix|--attr-source)
      ao_i=\$((ao_i + 1))
      ;;
    --git-dir=*|--work-tree=*|--config-env=*)
      ao_repo_opts+=("\$ao_arg")
      ;;
    -*)
      ;;
    *)
      ao_sub="\$ao_arg"
      break
      ;;
  esac
  ao_i=\$((ao_i + 1))
done

# Only a checkout or a switch can change the session branch.
case "\$ao_sub" in
  checkout|switch) ;;
  *) exec "\$real_git" "\$@" ;;
esac

# Read the session's own work tree and stored branch from its metadata.
# Without a session record, git runs directly.
ao_worktree=""
ao_stored_branch=""
ao_record="\${AO_DATA_DIR:-}/\${AO_SESSION:-}"
if [[ -n "\${AO_DATA_DIR:-}" && -n "\${AO_SESSION:-}" && -f "\$ao_record" ]]; then
  while IFS= read -r ao_line || [[ -n "\$ao_line" ]]; do
    case "\$ao_line" in
      worktree=*) ao_worktree="\${ao_line#worktree=}" ;;
      branch=*) ao_stored_branch="\${ao_line#branch=}" ;;
    esac
  done < "\$ao_record"
fi
if [[ -z "\$ao_worktree" ]]; then
  exec "\$real_git" "\$@"
fi

"\$real_git" "\$@"
exit_code=\$?

# Only update metadata on success, and only for the session's own work tree.
if [[ \$exit_code -eq 0 ]]; then
  ao_top="\$("\$real_git" "\${ao_repo_opts[@]}" rev-parse --show-toplevel 2>/dev/null)"
  if [[ -n "\$ao_top" && "\$ao_top" -ef "\$ao_worktree" ]]; then
    # The branch that HEAD names now, or nothing when HEAD is detached. The
    # full ref is read because --short gives "heads/<name>" when a tag has
    # the same name.
    ao_ref="\$("\$real_git" "\${ao_repo_opts[@]}" symbolic-ref -q HEAD 2>/dev/null)"
    ao_branch="\${ao_ref#refs/heads/}"
    if [[ -n "\$ao_ref" && "\$ao_branch" != "\$ao_ref" && "\$ao_branch" != "\$ao_stored_branch" ]]; then
      # Source the metadata helper
      ao_bin_dir="\$(cd "\$(dirname "\$0")" && pwd)"
      source "\$ao_bin_dir/ao-metadata-helper.sh" 2>/dev/null || true
      # No-op when the helper is missing so workers see only the real git output.
      if ! command -v update_ao_metadata >/dev/null 2>&1; then
        update_ao_metadata() { return 0; }
      fi
      update_ao_metadata branch "\$ao_branch"
    fi
  fi
fi

exit \$exit_code
`;

/**
 * Section appended to AGENTS.md as a secondary signal. The PATH-based wrappers
 * handle metadata updates automatically, but AGENTS.md reinforces the intent
 * and helps if the wrappers are bypassed.
 */
export const AO_AGENTS_MD_SECTION = `
## Agent Orchestrator (ao) Session

You are running inside an Agent Orchestrator managed workspace.
Session metadata is updated automatically via shell wrappers.

The wrappers update the session metadata. Do not edit the session record.
`;
/* eslint-enable no-useless-escape */

// =============================================================================
// Workspace Setup
// =============================================================================

/**
 * Atomically write a file by writing to a temp file in the same directory,
 * then renaming. Prevents concurrent sessions from reading partially written scripts.
 */
async function atomicWriteFile(filePath: string, content: string, mode: number): Promise<void> {
  const suffix = randomBytes(6).toString("hex");
  const tmpPath = `${filePath}.tmp.${suffix}`;
  await writeFile(tmpPath, content, { encoding: "utf-8", mode });
  await rename(tmpPath, filePath);
}

/**
 * Install PATH-based shell wrappers and append an AO section to AGENTS.md.
 *
 * This is the standard workspace setup for agents that don't have native hook
 * systems (Codex, Gemini, OpenCode). Call this from both `setupWorkspaceHooks`
 * and `postLaunchSetup`.
 *
 * 1. Creates ~/.ao/bin/ with gh/git wrappers and metadata helper script
 * 2. Appends an "Agent Orchestrator" section to the workspace AGENTS.md
 */
export async function setupPathWrapperWorkspace(workspacePath: string): Promise<void> {
  // 1. Write shared wrappers to ~/.ao/bin/.
  // Skip only when the version marker matches AND every wrapper file exists
  // with the exact expected content. A matching marker with a missing or
  // stale file (deleted or hand-edited wrapper) is repaired, so the wrappers
  // that a pane PATH names are present once any spawn has run.
  await mkdir(getAoBinDir(), { recursive: true });

  const markerPath = join(getAoBinDir(), ".ao-version");
  const expectedFiles: Array<[string, string]> = [
    [join(getAoBinDir(), "ao-metadata-helper.sh"), AO_METADATA_HELPER],
    [join(getAoBinDir(), "gh"), GH_WRAPPER],
    [join(getAoBinDir(), "git"), GIT_WRAPPER],
  ];
  let needsUpdate = true;
  try {
    const existing = await readFile(markerPath, "utf-8");
    if (existing.trim() === WRAPPER_VERSION) {
      needsUpdate = false;
      for (const [filePath, expectedContent] of expectedFiles) {
        try {
          const current = await readFile(filePath, "utf-8");
          if (current !== expectedContent) {
            needsUpdate = true;
            break;
          }
        } catch {
          // Missing or unreadable file — needs repair
          needsUpdate = true;
          break;
        }
      }
    }
  } catch {
    // Marker doesn't exist — needs update
  }

  if (needsUpdate) {
    await atomicWriteFile(join(getAoBinDir(), "ao-metadata-helper.sh"), AO_METADATA_HELPER, 0o755);
    // Write wrappers atomically, then write the version marker last.
    // If we crash between wrapper writes and marker write, the next
    // invocation will redo the writes (safe: wrappers are idempotent).
    await atomicWriteFile(join(getAoBinDir(), "gh"), GH_WRAPPER, 0o755);
    await atomicWriteFile(join(getAoBinDir(), "git"), GIT_WRAPPER, 0o755);
    await atomicWriteFile(markerPath, WRAPPER_VERSION, 0o644);
  }

  // 2. Write AO session context to .ao/AGENTS.md (gitignored) so agents
  //    can discover they're in a managed session. We don't modify the
  //    repo-tracked AGENTS.md to avoid polluting worktrees with dirty state.
  const aoAgentsMdPath = join(workspacePath, ".ao", "AGENTS.md");
  await mkdir(join(workspacePath, ".ao"), { recursive: true });
  await writeFile(aoAgentsMdPath, AO_AGENTS_MD_SECTION.trimStart(), "utf-8");
}
