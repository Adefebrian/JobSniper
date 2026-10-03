import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  SettingsService,
  csvFromRows,
  settingsView,
  validateSettings,
  xlsxFromRows,
} from "../src/modules/settings";

describe("settings", () => {
  test("defaults are valid and expose the dashboard view", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    const view = settingsView(DEFAULT_SETTINGS);
    expect(view.name).toBe("Ade Febrian");
    expect(view.countries.map((country) => country.code)).toContain("SG");
    expect(view.cvVariants.map((variant) => variant.id)).toEqual(["ai_fullstack", "ai_engineer"]);
  });

  test("rejects invalid caps and work windows", () => {
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, dailySendCap: -1 })).toThrow();
    expect(() => validateSettings({
      ...DEFAULT_SETTINGS,
      workWindows: { startHour: 12, endHour: 12, days: [2] },
    })).toThrow();
  });

  test("CSV export neutralizes spreadsheet formulas", () => {
    const csv = csvFromRows([{ company: "=HYPERLINK(\"bad\")", score: 91 }]);
    expect(csv).toContain(`"'=HYPERLINK(""bad"")"`);
    expect(csv).toContain("score");
  });

  test("XLSX export is a real workbook archive", () => {
    const workbook = xlsxFromRows([{ company: "JobSniper", score: 91 }], "targets");
    expect(new TextDecoder().decode(workbook.slice(0, 2))).toBe("PK");
    expect(workbook.length).toBeGreaterThan(500);
  });

  test("settings service persists patched values through its repository", async () => {
    let saved = structuredClone(DEFAULT_SETTINGS);
    const repository = {
      get: async () => saved,
      save: async (value: typeof DEFAULT_SETTINGS) => {
        saved = value;
        return value;
      },
    };
    const service = new SettingsService(
      repository as never,
      { parseProfile: async () => ({ result: { profile: {}, sourceText: "" }, usage: { model: "luna", purpose: "profile", requestId: "1", tokensIn: 0, tokensOut: 0, costUsd: 0 } }) } as never,
      { record: async () => undefined },
      { rows: async () => [] },
    );
    await service.patch({ dailySendCap: 12, monthlyLlmCapUsd: 20 });
    expect(saved.dailySendCap).toBe(12);
    expect(saved.monthlyLlmCapUsd).toBe(20);
  });
});
