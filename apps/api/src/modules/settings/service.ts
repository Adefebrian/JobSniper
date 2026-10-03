import { ApiError } from "../../core/http";
import type { LlmUsage, Settings } from "./ports";
import type { ExportProvider, LunaPort, UsageRecorder } from "./ports";
import { DEFAULT_SETTINGS } from "./defaults";
import { SettingsRepository } from "./repo";

export type SettingsView = {
  name: string;
  email: string;
  location: string;
  summary: string;
  skills: string[];
  availability: string;
  cvVariants: Array<{ id: string; name: string; roleType: string; fileName: string }>;
  countries: Array<{ code: string; name: string; weight: number }>;
  scoreWeights: {
    roleFit: number;
    seniority: number;
    modeVisa: number;
    freshness: number;
    skillOverlapCv: number;
  };
  sender: string;
  dailyCap: number;
  llmBudgetUsd: number;
};

function deepMerge<T>(base: T, patch: Record<string, unknown>): T {
  const result = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function xml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function bytesOf(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = bytesOf(file.name);
    const checksum = crc32(file.data);
    const header = [
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(checksum), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), name,
    ];
    local.push(...header, file.data);
    central.push(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(checksum), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    );
    offset += header.reduce((total, part) => total + part.length, 0) + file.data.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = [u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0)];
  return new Uint8Array([...local, ...central, ...end].flatMap((part) => [...part]));
}

export function csvFromRows(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n");
}

export function xlsxFromRows(rows: Array<Record<string, unknown>>, sheetName = "Export"): Uint8Array {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const allRows = rows.length === 0 ? [Object.fromEntries(columns.map((column) => [column, ""]))] : rows;
  const xmlRows = allRows.map((row, rowIndex) => {
    const cells = columns.map((column, columnIndex) => {
      const value = row[column];
      const letters = columnIndex < 26 ? String.fromCharCode(65 + columnIndex) : `A${String.fromCharCode(65 + columnIndex - 26)}`;
      const reference = `${letters}${rowIndex + 1}`;
      return typeof value === "number" && Number.isFinite(value)
        ? `<c r="${reference}"><v>${value}</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return zip([
    { name: "[Content_Types].xml", data: bytesOf(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: "_rels/.rels", data: bytesOf(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: bytesOf(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: bytesOf(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: bytesOf(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`) },
  ]);
}

function numberRecord(value: Record<string, unknown>, field: string, min: number, max: number): Record<string, number> {
  const entries = Object.entries(value);
  if (entries.length === 0) throw new ApiError(400, "validation_error", `${field} cannot be empty.`);
  return Object.fromEntries(entries.map(([key, item]) => {
    if (typeof item !== "number" || !Number.isFinite(item) || item < min || item > max) {
      throw new ApiError(400, "validation_error", `${field}.${key} must be between ${min} and ${max}.`);
    }
    return [key, item];
  }));
}

export function validateSettings(input: Settings): Settings {
  if (!input.profile || typeof input.profile !== "object" || Array.isArray(input.profile)) throw new ApiError(400, "validation_error", "profile must be an object.");
  if (!Array.isArray(input.profile.skills) || input.profile.skills.some((skill) => typeof skill !== "string")) throw new ApiError(400, "validation_error", "profile.skills must be an array of strings.");
  if (!input.cvVariants || typeof input.cvVariants !== "object" || Array.isArray(input.cvVariants)) throw new ApiError(400, "validation_error", "cvVariants must be an object.");
  if (Object.entries(input.cvVariants).some(([id, fileName]) => id.trim().length === 0 || typeof fileName !== "string" || fileName.length > 1_000)) {
    throw new ApiError(400, "validation_error", "cvVariants must map non-empty IDs to file names.");
  }
  numberRecord(input.countries, "countries", 0, 1);
  numberRecord(input.scoringWeights.seniority, "scoringWeights.seniority", 0, 10);
  numberRecord(input.scoringWeights.modeVisa, "scoringWeights.modeVisa", 0, 10);
  if (!input.modelPrices || typeof input.modelPrices !== "object" || Array.isArray(input.modelPrices)) throw new ApiError(400, "validation_error", "modelPrices must be an object.");
  for (const price of Object.values(input.modelPrices)) {
    if (!price || typeof price !== "object" || price.inputPerMillion < 0 || price.outputPerMillion < 0 || !Number.isFinite(price.inputPerMillion) || !Number.isFinite(price.outputPerMillion)) {
      throw new ApiError(400, "validation_error", "modelPrices must contain non-negative finite prices.");
    }
  }
  if (!Array.isArray(input.scoringWeights.freshnessDays) || input.scoringWeights.freshnessDays.length === 0) throw new ApiError(400, "validation_error", "scoringWeights.freshnessDays cannot be empty.");
  for (const item of input.scoringWeights.freshnessDays) {
    if (!Number.isInteger(item.maxDays) || item.maxDays < 0 || item.weight < 0 || item.weight > 10) throw new ApiError(400, "validation_error", "scoringWeights.freshnessDays is invalid.");
  }
  if (!["gmail", "smtp", "disabled"].includes(input.sender.provider)) throw new ApiError(400, "validation_error", "sender.provider is invalid.");
  if (input.sender.smtpPort !== undefined && (!Number.isInteger(input.sender.smtpPort) || input.sender.smtpPort < 1 || input.sender.smtpPort > 65_535)) throw new ApiError(400, "validation_error", "sender.smtpPort is invalid.");
  if (!Number.isInteger(input.dailySendCap) || input.dailySendCap < 0 || input.dailySendCap > 100) throw new ApiError(400, "validation_error", "dailySendCap must be between 0 and 100.");
  if (!Number.isFinite(input.monthlyLlmCapUsd) || input.monthlyLlmCapUsd < 0 || input.monthlyLlmCapUsd > 10_000) throw new ApiError(400, "validation_error", "monthlyLlmCapUsd must be between 0 and 10000.");
  if (!Number.isInteger(input.workWindows.startHour) || !Number.isInteger(input.workWindows.endHour) || input.workWindows.startHour < 0 || input.workWindows.endHour > 24 || input.workWindows.startHour >= input.workWindows.endHour) throw new ApiError(400, "validation_error", "workWindows must define a valid hour range.");
  if (!Array.isArray(input.workWindows.days) || input.workWindows.days.length === 0 || new Set(input.workWindows.days).size !== input.workWindows.days.length || input.workWindows.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new ApiError(400, "validation_error", "workWindows.days must contain unique weekdays from 0 to 6.");
  if (input.sourceYield.minRelevantPer100 < 0 || input.sourceYield.maxDuplicateRatio < 0 || input.sourceYield.maxDuplicateRatio > 1 || !Number.isInteger(input.sourceYield.observationDays) || input.sourceYield.observationDays < 1) throw new ApiError(400, "validation_error", "sourceYield is invalid.");
  return structuredClone(input);
}

const COUNTRY_NAMES: Record<string, string> = {
  SG: "Singapore", AU: "Australia", NZ: "New Zealand", US: "United States", UK: "United Kingdom", CA: "Canada",
  CH: "Switzerland", DE: "Germany", AE: "United Arab Emirates", QA: "Qatar", SA: "Saudi Arabia", ID: "Indonesia", other: "Other",
};

export function settingsView(settings: Settings): SettingsView {
  const profile = settings.profile as Record<string, unknown>;
  return {
    name: String(profile.name ?? ""), email: String(profile.email ?? ""), location: String(profile.location ?? ""),
    summary: String(profile.summary ?? ""), skills: Array.isArray(profile.skills) ? profile.skills.map(String) : [],
    availability: String(profile.availability ?? ""),
    cvVariants: Object.entries(settings.cvVariants).map(([id, fileName]) => ({
      id, name: id.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      roleType: id.includes("fullstack") ? "AI Fullstack" : "AI Engineer", fileName: String(fileName),
    })),
    countries: Object.entries(settings.countries).map(([code, weight]) => ({ code, name: COUNTRY_NAMES[code] ?? code, weight })),
    scoreWeights: {
      roleFit: settings.scoringWeights.country,
      seniority: settings.scoringWeights.seniority.mid ?? 0,
      modeVisa: settings.scoringWeights.modeVisa.remote_global ?? 0,
      freshness: settings.scoringWeights.freshnessDays[0]?.weight ?? 1,
      skillOverlapCv: settings.scoringWeights.skillOverlap,
    },
    sender: settings.sender.fromEmail, dailyCap: settings.dailySendCap, llmBudgetUsd: settings.monthlyLlmCapUsd,
  };
}

function scaleRecord(value: Record<string, number>, factor: number): Record<string, number> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Math.min(10, Math.max(0, item * factor))]));
}

export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly luna: LunaPort,
    private readonly usage: UsageRecorder,
    private readonly exports: ExportProvider,
  ) {}

  async get(): Promise<Settings> {
    const current = await this.repository.get();
    if (current) return current;
    return this.repository.save(structuredClone(DEFAULT_SETTINGS));
  }

  async getView(): Promise<SettingsView> {
    return settingsView(await this.get());
  }

  async patch(patch: Record<string, unknown>): Promise<Settings> {
    const current = await this.get();
    const allowed = new Set(["profile", "cvVariants", "countries", "scoringWeights", "sender", "dailySendCap", "monthlyLlmCapUsd", "modelPrices", "workWindows", "sourceYield"]);
    const unknown = Object.keys(patch).filter((key) => !allowed.has(key));
    if (unknown.length > 0) throw new ApiError(400, "validation_error", "Settings contains unsupported fields.", { unknown });
    return this.repository.save(validateSettings(deepMerge(current, patch)));
  }

  async putView(input: unknown): Promise<SettingsView> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "validation_error", "A settings object is required.");
    const view = input as Partial<SettingsView>;
    const current = await this.get();
    const cvVariants = Array.isArray(view.cvVariants) ? Object.fromEntries(view.cvVariants.map((variant) => [variant.id, variant.fileName])) : undefined;
    const countries = Array.isArray(view.countries) ? Object.fromEntries(view.countries.map((country) => [country.code, country.weight])) : undefined;
    const score = view.scoreWeights;
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const next = validateSettings({
      ...current,
      profile: {
        ...current.profile,
        ...(view.name === undefined ? {} : {
          name: view.name,
          email: view.email ?? "",
          location: view.location ?? "",
          summary: view.summary ?? "",
          skills: view.skills ?? [],
          availability: view.availability ?? "",
        }),
      },
      cvVariants: cvVariants ?? current.cvVariants,
      countries: countries ?? current.countries,
      sender: view.sender === undefined
        ? current.sender
        : { ...current.sender, provider: current.sender.provider, fromEmail: view.sender, fromName: current.sender.fromName },
      dailySendCap: view.dailyCap ?? current.dailySendCap,
      monthlyLlmCapUsd: view.llmBudgetUsd ?? current.monthlyLlmCapUsd,
      scoringWeights: score ? {
        ...current.scoringWeights,
        skillOverlap: score.skillOverlapCv,
        country: score.roleFit,
        seniority: scaleRecord(current.scoringWeights.seniority, score.seniority / Math.max(average(Object.values(current.scoringWeights.seniority)), 0.01)),
        modeVisa: scaleRecord(current.scoringWeights.modeVisa, score.modeVisa / Math.max(average(Object.values(current.scoringWeights.modeVisa)), 0.01)),
        freshnessDays: current.scoringWeights.freshnessDays.map((item) => ({ ...item, weight: Math.min(10, Math.max(0, item.weight * score.freshness / Math.max(average(current.scoringWeights.freshnessDays.map((entry) => entry.weight)), 0.01))) })),
      } : current.scoringWeights,
    });
    return settingsView(await this.repository.save(validateSettings(next)));
  }

  async parseProfile(sourceText: string): Promise<Record<string, unknown>> {
    if (sourceText.trim().length < 100) throw new ApiError(400, "validation_error", "sourceText must contain the CV text.");
    const parsed = await this.luna.parseProfile({ sourceText });
    await this.usage.record(parsed.usage);
    const settings = await this.patch({ profile: parsed.result.profile });
    return { profile: settings.profile, usage: parsed.usage };
  }

  async recordUsage(usage: LlmUsage): Promise<void> {
    await this.usage.record(usage);
  }

  async exportRows(kind: string): Promise<Array<Record<string, unknown>>> {
    if (kind !== "targets" && kind !== "outreach") throw new ApiError(404, "export_not_found", "Export kind must be targets or outreach.");
    return this.exports.rows(kind);
  }

  async exportCsv(kind: string): Promise<string> {
    return csvFromRows(await this.exportRows(kind));
  }

  async exportXlsx(kind: string): Promise<Uint8Array> {
    return xlsxFromRows(await this.exportRows(kind), kind);
  }
}
