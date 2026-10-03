import type { Settings } from "../../core/domain";

export const DEFAULT_SETTINGS: Settings = {
  profile: {
    name: "Ade Febrian",
    email: "",
    location: "Indonesia",
    timezone: "Asia/Jakarta",
    skills: [],
    achievements: [],
    availability: "",
    noticePeriod: "",
  },
  cvVariants: {
    ai_fullstack: "",
    ai_engineer: "",
  },
  countries: {
    SG: 1,
    AU: 0.95,
    NZ: 0.95,
    US: 0.9,
    UK: 0.9,
    CA: 0.9,
    CH: 0.85,
    DE: 0.85,
    AE: 0.8,
    QA: 0.8,
    SA: 0.75,
    other: 0.5,
  },
  scoringWeights: {
    seniority: {
      mid: 1,
      early: 0.9,
      senior: 0.7,
      lead: 0.4,
      unknown: 0.5,
    },
    modeVisa: {
      remote_global: 1,
      remote_apac: 0.95,
      onsite_sponsor_yes: 0.85,
      sponsor_unknown: 0.65,
      remote_restricted: 0.35,
      sponsor_no: 0.15,
    },
    freshnessDays: [
      { maxDays: 1, weight: 1 },
      { maxDays: 3, weight: 0.9 },
      { maxDays: 7, weight: 0.75 },
      { maxDays: 30, weight: 0.5 },
    ],
    skillOverlap: 1,
    country: 1,
  },
  sender: {
    provider: "gmail",
    fromEmail: "",
    fromName: "Ade Febrian",
  },
  dailySendCap: 20,
  monthlyLlmCapUsd: 30,
  modelPrices: {
    "gpt-6-luna": { inputPerMillion: 2, outputPerMillion: 8 },
  },
  workWindows: {
    startHour: 8,
    endHour: 11,
    days: [2, 3, 4],
  },
  sourceYield: {
    minRelevantPer100: 1,
    maxDuplicateRatio: 0.95,
    observationDays: 14,
  },
};
