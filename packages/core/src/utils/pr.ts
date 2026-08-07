import type { PRInfo } from "../types.js";

export type ParsedPrUrl = Pick<PRInfo, "owner" | "repo" | "number" | "url">;

const GITHUB_PR_URL_REGEX = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const TRAILING_NUMBER_REGEX = /\/(\d+)$/;

export function parsePrFromUrl(prUrl: string): ParsedPrUrl | null {
  const githubMatch = prUrl.match(GITHUB_PR_URL_REGEX);
  if (githubMatch) {
    const [, owner, repo, prNumber] = githubMatch;
    return {
      owner,
      repo,
      number: parseInt(prNumber, 10),
      url: prUrl,
    };
  }

  const trailingNumberMatch = prUrl.match(TRAILING_NUMBER_REGEX);
  if (trailingNumberMatch) {
    return {
      owner: "",
      repo: "",
      number: parseInt(trailingNumberMatch[1], 10),
      url: prUrl,
    };
  }

  return null;
}

/**
 * Stable identity key for a PR, safe to use for deduplication.
 *
 * Falls back to the URL whenever owner/repo/number are not all known. Keying on
 * `owner/repo#number` alone collides for any provider `parsePrFromUrl` cannot
 * fully decompose — e.g. two GitLab MRs numbered 12 in different projects both
 * parse to `owner: ""`, `repo: ""`, and would otherwise share the key `/#12`.
 */
export function prIdentityKey(pr: Pick<PRInfo, "owner" | "repo" | "number" | "url">): string {
  const parsed = parsePrFromUrl(pr.url);
  const owner = pr.owner || parsed?.owner || "";
  const repo = pr.repo || parsed?.repo || "";
  const number = pr.number || parsed?.number || 0;

  if (owner && repo && number > 0) {
    return `${owner}/${repo}#${number}`;
  }
  return `url:${pr.url}`;
}
