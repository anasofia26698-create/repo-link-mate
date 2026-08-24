export const TEMPORARY_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type FlowEntryLike = {
  source: "imported" | "manual";
  createdAt?: number;
};

export function isTemporaryEntryActive(entry: FlowEntryLike, now: number): boolean {
  return entry.source === "imported" || !entry.createdAt || now - entry.createdAt < TEMPORARY_ENTRY_TTL_MS;
}

export function replaceImportedEntries<T extends FlowEntryLike>(existing: T[], imported: T[], now: number): T[] {
  return [...existing.filter((entry) => entry.source === "manual" && isTemporaryEntryActive(entry, now)), ...imported];
}
