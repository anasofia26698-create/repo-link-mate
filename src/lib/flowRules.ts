export type FlowEntryLike = {
  source: "imported" | "manual";
  createdAt?: number;
};

export function isTemporaryEntryActive(entry: FlowEntryLike, now: number): boolean {
  return entry.source === "imported" || entry.source === "manual";
}

export function replaceImportedEntries<T extends FlowEntryLike>(existing: T[], imported: T[], now: number): T[] {
  return [...existing.filter((entry) => entry.source === "manual" && isTemporaryEntryActive(entry, now)), ...imported];
}
