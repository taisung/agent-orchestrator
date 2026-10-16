/**
 * Branch-name and PR-URL validation (m-13).
 *
 * The branch rule accepts exactly the names that
 * `git check-ref-format --branch` accepts, without the `@{N}` previous-checkout
 * expansion, and it refuses a name that starts with `-`.
 *
 * Rules, from `git-check-ref-format(1)` (Git 2.43.0):
 *
 *  1. No slash-separated component can begin with a dot `.` or end with
 *     the sequence `.lock`.
 *  2. (Waived for `--branch`: one-level names such as `main` are allowed.
 *     Without `--allow-onelevel` a ref must contain at least one `/`.)
 *  3. They cannot have two consecutive dots `..` anywhere.
 *  4. They cannot have ASCII control characters (bytes lower than `040`,
 *     or `177` DEL), space, tilde `~`, caret `^`, or colon `:` anywhere.
 *  5. They cannot have question-mark `?`, asterisk `*`, or open bracket `[`
 *     anywhere.
 *  6. They cannot begin or end with a slash `/` or contain multiple
 *     consecutive slashes `//`.
 *  7. They cannot end with a dot `.`.
 *  8. They cannot contain a sequence `@{`.
 *  9. They cannot be the single character `@`.
 *  10. They cannot contain a backslash `\`.
 *
 * With `--branch`, git additionally refuses:
 *  - a name that starts with `-` (a dash may appear at the beginning of a
 *    ref component, but it is explicitly forbidden at the beginning of a
 *    branch name),
 *  - the name `HEAD` (`'HEAD' is not a valid branch name`),
 *  - the empty name,
 *  - and, when run in a repository, it first expands the previous-checkout
 *    syntax `@{N}` (for example `@{ -1}`). This implementation never expands:
 *    any name containing `@{` is refused, so `@{ -1}` and similar fail.
 *
 * This implementation is stricter than `git check-ref-format --branch` in
 * one case: git accepts the single character `@` as a branch shorthand, but
 * this function refuses it (an agent-controlled `@` must not reach git as a
 * revision).
 *
 * Pure function: no `git` call, no I/O.
 */
export function isSafeBranchName(name: string): boolean {
  if (name.length === 0) return false;
  if (name === "@" || name === "HEAD") return false;
  if (name.startsWith("-")) return false;
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) return false;
  if (name.endsWith(".")) return false;
  if (name.includes("..")) return false;
  if (name.includes("@{")) return false;

  // Rule 4 + 5 + 10: control chars, space, ~ ^ : ? * [ \ .
  // Space is 0x20; controls are 0x00-0x1F and 0x7F. Other bytes >= 0x80
  // (UTF-8) are allowed, matching git.
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
    const ch = name[i];
    if (ch === "~" || ch === "^" || ch === ":" || ch === "?" || ch === "*" || ch === "[") {
      return false;
    }
    if (ch === "\\") return false;
  }

  // Rule 1: no component begins with `.` or ends with `.lock`.
  const parts = name.split("/");
  for (const part of parts) {
    if (part.length === 0) return false;
    if (part.startsWith(".")) return false;
    if (part.endsWith(".lock")) return false;
  }

  return true;
}

/**
 * PR-URL validation (m-13).
 *
 * Accepts only `https://github.com/<owner>/<repo>/pull/<number>`, where owner
 * and repo use `[A-Za-z0-9._-]` and number uses `[0-9]`. This matches what the
 * `gh` wrapper extracts (`grep -Eo 'https://github\\.com/[^/]+/[^/]+/pull/[0-9]+'`)
 * tightened to the same character class the helper enforces.
 *
 * Pure function: no I/O.
 */
export function isSafePrUrl(value: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/[0-9]+$/.test(value);
}
