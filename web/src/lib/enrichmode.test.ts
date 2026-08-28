import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichSettingsInfo } from "./types";

const enrichSettings = vi.fn<() => Promise<EnrichSettingsInfo>>();
vi.mock("./api", () => ({ api: { enrichSettings: () => enrichSettings() } }));

const { getEnrichInfo, invalidateEnrichInfo } = await import("./enrichmode");

const info = (deepReady: boolean) =>
  ({ settings: {}, availability: {}, deepReady }) as unknown as EnrichSettingsInfo;

describe("getEnrichInfo", () => {
  beforeEach(() => {
    invalidateEnrichInfo();
    enrichSettings.mockReset();
  });

  it("fetches once and serves the cache afterwards", async () => {
    enrichSettings.mockResolvedValue(info(true));

    await expect(getEnrichInfo()).resolves.toEqual(info(true));
    await expect(getEnrichInfo()).resolves.toEqual(info(true));
    expect(enrichSettings).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    enrichSettings.mockResolvedValue(info(true));

    await Promise.all([getEnrichInfo(), getEnrichInfo(), getEnrichInfo()]);
    expect(enrichSettings).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejected request, so a later call retries", async () => {
    enrichSettings.mockRejectedValueOnce(new Error("server restarting"));
    await expect(getEnrichInfo()).rejects.toThrow("server restarting");

    enrichSettings.mockResolvedValue(info(true));
    await expect(getEnrichInfo()).resolves.toEqual(info(true));
    expect(enrichSettings).toHaveBeenCalledTimes(2);
  });

  it("refetches after the settings page invalidates the cache", async () => {
    enrichSettings.mockResolvedValue(info(true));
    await getEnrichInfo();

    invalidateEnrichInfo();
    enrichSettings.mockResolvedValue(info(false));

    await expect(getEnrichInfo()).resolves.toEqual(info(false));
    expect(enrichSettings).toHaveBeenCalledTimes(2);
  });

  it("seeds the cache from a saved value without refetching", async () => {
    invalidateEnrichInfo(info(false));

    await expect(getEnrichInfo()).resolves.toEqual(info(false));
    expect(enrichSettings).not.toHaveBeenCalled();
  });
});
