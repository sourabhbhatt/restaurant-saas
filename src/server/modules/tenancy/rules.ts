/**
 * Pure tenancy rules (no I/O), unit tested in rules.test.ts.
 */

export const OWNER_ROLE_KEY = "workspace_owner";
export const MEMBER_ROLE_KEY = "workspace_member";
export const INVITATION_TTL_DAYS = 7;

/** Base branch code from a name: upper-case letters and digits, 2–8 chars. */
export function baseBranchCode(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  const code = cleaned.slice(0, 8);
  return code.length >= 2 ? code : `BR${code}`.slice(0, 8);
}

/** First free code: BASE, BASE-2, BASE-3 ... (case-insensitive against `taken`). */
export function nextFreeBranchCode(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((c) => c.toUpperCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

export type OwnerChange = "demote" | "disable" | "remove";

/**
 * A workspace must keep at least one active owner. Returns an error message
 * when the change would leave none, else null.
 */
export function lastOwnerViolation(input: {
  targetIsActiveOwner: boolean;
  change: OwnerChange | null;
  activeOwnerCount: number;
}): string | null {
  if (!input.targetIsActiveOwner || !input.change) return null;
  if (input.activeOwnerCount > 1) return null;
  return "A workspace needs at least one owner. Make another member an owner first.";
}

/** Custom role key: stable, unique per workspace (suffix added by caller on clash). */
export function customRoleKey(name: string, suffix: string): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "role";
  return `custom_${slug}_${suffix}`;
}
