/**
 * Parse a key=value file into a record.
 * Lines starting with # are comments. Empty lines are skipped.
 * Only the first "=" is used as the delimiter (values can contain "=").
 */
export function parseKeyValueContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/**
 * `parseKeyValueContent` for a decision that must not read a damaged record
 * as a record that names nothing (same-ID R4 round 3, M-5). Comments and
 * blank lines are legal, as there. Every other line must be `key=value` with
 * a key of letters, digits, "_", "." or "-", and no key may come twice. Any
 * other line throws: the lenient parser leaves it out, or keeps only the
 * last of two values.
 */
export function parseKeyValueContentStrict(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [index, line] of content.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    const key = eqIndex === -1 ? "" : trimmed.slice(0, eqIndex).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
      throw new Error(`line ${index + 1} is not a key=value line`);
    }
    if (Object.hasOwn(result, key)) {
      throw new Error(`line ${index + 1} sets ${key} a second time`);
    }
    result[key] = trimmed.slice(eqIndex + 1).trim();
  }
  return result;
}
