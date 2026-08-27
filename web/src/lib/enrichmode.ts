// Tiny module-level cache of enrichment settings so every card doesn't
// refetch. Settings page invalidates it on save.
import { api } from "./api";
import type { EnrichSettingsInfo } from "./types";

let cached: EnrichSettingsInfo | null = null;
let inflight: Promise<EnrichSettingsInfo> | null = null;

export async function getEnrichInfo(): Promise<EnrichSettingsInfo> {
  if (cached) return cached;
  // Clear the in-flight slot on failure too — a rejected promise must never
  // be cached, or one bad request (server restarting) bricks every later call.
  inflight ??= api
    .enrichSettings()
    .then((i) => {
      cached = i;
      return i;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateEnrichInfo(next?: EnrichSettingsInfo) {
  cached = next ?? null;
}
