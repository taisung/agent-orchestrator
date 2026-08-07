import { describe, it, expect } from "vitest";
import { parsePrFromUrl, prIdentityKey } from "../utils/pr.js";

function prFromUrl(url: string) {
  const parsed = parsePrFromUrl(url);
  return {
    owner: parsed?.owner ?? "",
    repo: parsed?.repo ?? "",
    number: parsed?.number ?? 0,
    url,
  };
}

describe("prIdentityKey", () => {
  it("uses owner/repo#number when the URL fully decomposes", () => {
    const pr = prFromUrl("https://github.com/acme/frontend/pull/12");
    expect(prIdentityKey(pr)).toBe("acme/frontend#12");
  });

  it("treats the same GitHub PR as one identity regardless of URL suffix", () => {
    const a = prFromUrl("https://github.com/acme/frontend/pull/12");
    const b = prFromUrl("https://github.com/acme/frontend/pull/12/files");
    expect(prIdentityKey(a)).toBe(prIdentityKey(b));
  });

  it("separates same-numbered PRs in different repos", () => {
    const a = prFromUrl("https://github.com/acme/frontend/pull/12");
    const b = prFromUrl("https://github.com/acme/backend/pull/12");
    expect(prIdentityKey(a)).not.toBe(prIdentityKey(b));
  });

  // parsePrFromUrl cannot decompose GitLab MR URLs into owner/repo, so it returns
  // empty strings. Keying on `owner/repo#number` collapsed every such MR sharing a
  // number into "/#12", silently dropping all but one from PR enrichment.
  it("separates same-numbered GitLab MRs from different projects", () => {
    const a = prFromUrl("https://gitlab.com/acme/frontend/-/merge_requests/12");
    const b = prFromUrl("https://gitlab.com/acme/backend/-/merge_requests/12");

    expect(a.owner).toBe("");
    expect(b.owner).toBe("");
    expect(`${a.owner}/${a.repo}#${a.number}`).toBe(`${b.owner}/${b.repo}#${b.number}`);
    expect(prIdentityKey(a)).not.toBe(prIdentityKey(b));
  });

  it("falls back to the URL when the PR number is unknown", () => {
    const pr = { owner: "", repo: "", number: 0, url: "https://example.com/review/abc" };
    expect(prIdentityKey(pr)).toBe("url:https://example.com/review/abc");
  });

  it("dedupes a mixed GitHub/GitLab list without collapsing distinct PRs", () => {
    const prs = [
      prFromUrl("https://github.com/acme/frontend/pull/12"),
      prFromUrl("https://github.com/acme/frontend/pull/12/files"),
      prFromUrl("https://gitlab.com/acme/frontend/-/merge_requests/12"),
      prFromUrl("https://gitlab.com/acme/backend/-/merge_requests/12"),
    ];

    const unique = Array.from(new Map(prs.map((pr) => [prIdentityKey(pr), pr])).values());
    expect(unique).toHaveLength(3);
  });

  it("prefers explicit owner/repo fields over re-parsing the URL", () => {
    const pr = {
      owner: "acme",
      repo: "frontend",
      number: 12,
      url: "https://gitlab.com/acme/frontend/-/merge_requests/12",
    };
    expect(prIdentityKey(pr)).toBe("acme/frontend#12");
  });
});
