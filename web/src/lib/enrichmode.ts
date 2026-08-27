// Tiny module-level cache of enrichment settings so every card doesn't
// refetch. Settings page invalidates it on save.
import { api } from "./api";
import type { EnrichSettingsInfo } from "./types";

let cached: EnrichSettingsInfo | null = null;
let inflight: Promise<EnrichSettingsInfo> | null = null;

export async function getEnrichInfo(): Promise<EnrichSettingsInfo> {
  if (cached) return cached;
  inflight ??= api.enrichSettings().then((i) => {
    cached = i;
    inflight = null;
    return i;
  });
  return inflight;
}

export function invalidateEnrichInfo(next?: EnrichSettingsInfo) {
  cached = next ?? null;
}
