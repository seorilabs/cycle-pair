/** Accept code-only shares and the complete invitation text from older builds. */
export function normalizeInviteCode(value: string): string {
  const trimmed = value.trim();
  const candidates = new Set(
    (trimmed.match(/[A-Za-z0-9_-]+/g) ?? []).filter(word => word.length === 43),
  );
  return candidates.size === 1 ? [...candidates][0] : trimmed;
}
