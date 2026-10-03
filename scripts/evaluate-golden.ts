import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type SeniorityBucket = "mid" | "early" | "senior" | "lead" | "unknown";

export type GoldenCase = {
  id: string;
  title: string;
  description: string;
  country: string;
  label: boolean;
  reason: string;
  seniority?: SeniorityBucket;
};

export type RuleEvidence = {
  quote: string;
  source: "title" | "description";
  reason: string;
};

export type RuleResult = {
  roleRelevant: boolean;
  languageFit: boolean;
  predictedRelevant: boolean;
  roleReason: string;
  languageReason: string;
  roleEvidence: RuleEvidence[];
  languageEvidence: RuleEvidence[];
};

export type CaseEvaluation = GoldenCase & RuleResult & {
  outcome: "true_positive" | "true_negative" | "false_positive" | "false_negative";
};

export type Metrics = {
  total: number;
  actualPositive: number;
  actualNegative: number;
  predictedPositive: number;
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  accuracy: number;
};

export type EvaluationReport = {
  path: string;
  cases: CaseEvaluation[];
  overall: Metrics;
  byCountry: Record<string, Metrics>;
  bySeniority: Record<string, Metrics>;
  precisionThreshold: number;
  precisionGatePassed: boolean;
};

type LanguageRule = {
  name: string;
  match: RegExp;
  strongRequired: RegExp;
  levelRequired: RegExp;
  optional: RegExp;
};

const AI_EVIDENCE_PATTERN = /\b(?:ai|llm|genai|large language model|generative ai|generative artificial intelligence|applied ai|agentic|agents?|ai[- ]assisted)\b/iu;
const PRODUCT_ML_PATTERN = /\b(?:machine learning|ml|mlops|models?|inference)\b/iu;
const PRODUCT_EVIDENCE_PATTERN = /\b(?:deploy(?:ed|ing)?|deployment|production|customer[- ]facing|product[- ]facing|inference services?|recommendation|recommender|real[- ]time)\b/iu;
const ENGINEERING_PATTERN = /\b(?:engineer|engineering|developer|software|fullstack|full stack|backend|back[- ]end|platform)\b/iu;

const DISQUALIFIERS: Array<{ label: string; pattern: RegExp; titleOnly?: boolean }> = [
  {
    label: "graduate, new-grad, intern, or apprentice role",
    pattern: /\b(?:graduate|new grad(?:uate)?|intern(?:ship)?|apprentice)\b/iu,
  },
  {
    label: "AI training or annotation role",
    pattern: /\b(?:ai trainer|data annotator|data label(?:ing|ling)|prompt annotator)\b/iu,
  },
  {
    label: "pure research role",
    pattern: /\b(?:research scientist|research-only|no production software ownership)\b/iu,
  },
  {
    label: "non-engineering role",
    pattern: /\b(?:sales|marketing|recruiter|talent acquisition|business development)\b/iu,
    titleOnly: true,
  },
];

const ENGLISH_MARKERS = [
  "english",
  "englisch",
  "anglais",
  "inglés",
  "ingles",
  "inglese",
  "engels",
  "engelska",
  "الإنجليزية",
  "الانجليزية",
  "英語",
  "英语",
  "영어",
];

const LANGUAGE_RULES: LanguageRule[] = [
  {
    name: "German",
    match: /\b(?:german|deutsch)\b/iu,
    strongRequired: /\b(?:required|requirement|mandatory|must|native|near[- ]native|verhandlungssicher|voraussetzung)\b/iu,
    levelRequired: /\b(?:c1|c2|business level|professional proficiency|fluent|fluency)\b/iu,
    optional: /\b(?:plus|preferred|optional|nice to have|advantage|von vorteil|wünschenswert)\b/iu,
  },
  {
    name: "French",
    match: /\b(?:french|français|francais)\b/iu,
    strongRequired: /\b(?:required|requirement|mandatory|must|native|near[- ]native|exigé|exige)\b/iu,
    levelRequired: /\b(?:c1|c2|business level|professional proficiency|fluent|fluency)\b/iu,
    optional: /\b(?:plus|preferred|optional|nice to have|advantage|souhaité|souhaite)\b/iu,
  },
  {
    name: "Arabic",
    match: /\b(?:arabic|العربية)\b/iu,
    strongRequired: /\b(?:required|requirement|mandatory|must|native|near[- ]native|مطلوب|إجادة)\b/iu,
    levelRequired: /\b(?:c1|c2|business level|professional proficiency|fluent|fluency)\b/iu,
    optional: /\b(?:plus|preferred|optional|nice to have|advantage|يُفضَّل|يفضل)\b/iu,
  },
  {
    name: "Japanese",
    match: /\b(?:japanese|日本語)\b/iu,
    strongRequired: /\b(?:required|requirement|mandatory|must|native|near[- ]native|必須|ネイティブ)\b/iu,
    levelRequired: /\b(?:c1|c2|business level|professional proficiency|fluent|fluency)\b/iu,
    optional: /\b(?:plus|preferred|optional|nice to have|advantage|歓迎)\b/iu,
  },
  {
    name: "Korean",
    match: /\b(?:korean|한국어)\b/iu,
    strongRequired: /\b(?:required|requirement|mandatory|must|native|near[- ]native|필수|원어민)\b/iu,
    levelRequired: /\b(?:c1|c2|business level|professional proficiency|fluent|fluency)\b/iu,
    optional: /\b(?:plus|preferred|optional|nice to have|advantage|우대)\b/iu,
  },
  {
    name: "Mandarin",
    match: /\b(?:mandarin|chinese|普通话|中文)\b/iu,
    strongRequired: /\b(?:required|requirement|mandatory|must|native|near[- ]native|必须|母语)\b/iu,
    levelRequired: /\b(?:c1|c2|business level|professional proficiency|fluent|fluency)\b/iu,
    optional: /\b(?:plus|preferred|optional|nice to have|advantage|优先|加分)\b/iu,
  },
  {
    name: "Dutch",
    match: /\b(?:dutch|nederlands)\b/iu,
    strongRequired: /\b(?:required|requirement|mandatory|must|native|near[- ]native|vereist|moedertaal)\b/iu,
    levelRequired: /\b(?:c1|c2|business level|professional proficiency|fluent|fluency)\b/iu,
    optional: /\b(?:plus|preferred|optional|nice to have|advantage|pre|gewenst)\b/iu,
  },
  {
    name: "Spanish",
    match: /\b(?:spanish|español|espanol)\b/iu,
    strongRequired: /\b(?:required|requirement|mandatory|must|native|near[- ]native|exigido|nativo)\b/iu,
    levelRequired: /\b(?:c1|c2|business level|professional proficiency|fluent|fluency)\b/iu,
    optional: /\b(?:plus|preferred|optional|nice to have|advantage|deseable|deseable)\b/iu,
  },
];

const FOREIGN_SIGNALS = [
  /\b(?:wir suchen|für|mitarbeiter|erfahrung|voraussetzung|verhandlungssicher|fließend|arbeitsort|m\/w\/d)\b/iu,
  /\b(?:nous|recherchons|expérience|vous|avec|ingénieur|exigé|h\/f)\b/iu,
  /\b(?:buscamos|experiencia|para|con|responsable|nativo)\b/iu,
  /\b(?:ervaring|voor|met|vereist|nederlandse)\b/iu,
  /\b(?:conoscenza|esperienza|richiediamo|italiaans)\b/iu,
];

const ENGLISH_SIGNALS = /\b(?:the|and|or|to|of|in|for|with|on|at|by|from|as|is|are|will|you|your|our|we|be|have|has|can|may|build|work|role|team|experience|production|engineer|developer|remote|language)\b/giu;

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function findEvidence(
  text: string,
  pattern: RegExp,
  source: RuleEvidence["source"],
  reason: string,
): RuleEvidence | undefined {
  const sentence = splitSentences(text).find((candidate) => pattern.test(candidate));
  return sentence ? { quote: sentence, source, reason } : undefined;
}

function firstEvidence(
  title: string,
  description: string,
  pattern: RegExp,
  reason: string,
): RuleEvidence | undefined {
  return findEvidence(title, pattern, "title", reason) ?? findEvidence(description, pattern, "description", reason);
}

function parseSeniority(value: unknown): SeniorityBucket | undefined {
  if (typeof value !== "string") return undefined;
  const seniority = normalized(value);
  if (seniority === "mid" || seniority === "middle" || seniority === "intermediate") return "mid";
  if (seniority === "early" || seniority === "junior" || seniority === "entry") return "early";
  if (seniority === "senior" || seniority === "sr") return "senior";
  if (seniority === "lead" || seniority === "staff" || seniority === "principal") return "lead";
  if (seniority === "unknown") return "unknown";
  return undefined;
}

export function inferSeniority(input: GoldenCase): SeniorityBucket {
  const explicit = parseSeniority(input.seniority);
  if (explicit) return explicit;
  const title = normalized(input.title);
  if (/\b(?:lead|staff|principal|head of|architect)\b/u.test(title)) return "lead";
  if (/\b(?:senior|sr)\b/u.test(title)) return "senior";
  if (/\b(?:mid|intermediate)\b/u.test(title)) return "mid";
  if (/\b(?:junior|entry|early)\b/u.test(title)) return "early";
  return "unknown";
}

function validateCase(value: unknown, lineNumber: number): GoldenCase {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`line ${lineNumber}: case must be a JSON object`);
  }
  const candidate = value as Record<string, unknown>;
  for (const field of ["id", "title", "description", "country", "reason"] as const) {
    if (typeof candidate[field] !== "string" || candidate[field].trim() === "") {
      throw new Error(`line ${lineNumber}: ${field} must be a non-empty string`);
    }
  }
  if (typeof candidate.label !== "boolean") {
    throw new Error(`line ${lineNumber}: label must be boolean`);
  }
  const seniority = parseSeniority(candidate.seniority);
  if (candidate.seniority !== undefined && !seniority) {
    throw new Error(`line ${lineNumber}: unsupported seniority`);
  }
  return {
    id: candidate.id as string,
    title: candidate.title as string,
    description: candidate.description as string,
    country: (candidate.country as string).trim().toUpperCase(),
    label: candidate.label,
    reason: candidate.reason as string,
    ...(seniority ? { seniority } : {}),
  };
}

export function parseGoldenCases(text: string): GoldenCase[] {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/u)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, lineNumber }) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`line ${lineNumber}: invalid JSON`);
      }
      const item = validateCase(value, lineNumber);
      if (seen.has(item.id)) throw new Error(`line ${lineNumber}: duplicate id ${item.id}`);
      seen.add(item.id);
      return item;
    });
}

function evaluateRole(input: GoldenCase): {
  relevant: boolean;
  reason: string;
  evidence: RuleEvidence[];
} {
  const text = `${input.title}\n${input.description}`;
  const title = normalized(input.title);
  const fullText = normalized(text);
  const disqualifier = DISQUALIFIERS.find(({ pattern, titleOnly }) =>
    pattern.test(titleOnly ? title : fullText),
  );
  if (disqualifier) {
    return {
      relevant: false,
      reason: `Excluded by pre-filter: ${disqualifier.label}.`,
      evidence: [],
    };
  }

  const aiEvidence = firstEvidence(input.title, input.description, AI_EVIDENCE_PATTERN, "AI/LLM evidence");
  const productMlEvidence = firstEvidence(input.title, input.description, PRODUCT_ML_PATTERN, "Product ML evidence");
  const productEvidence = firstEvidence(input.title, input.description, PRODUCT_EVIDENCE_PATTERN, "Product-facing evidence");
  const engineeringEvidence = firstEvidence(input.title, input.description, ENGINEERING_PATTERN, "Engineering evidence");

  const directAiRelevant = Boolean(aiEvidence && engineeringEvidence);
  const productMlRelevant = Boolean(productMlEvidence && productEvidence && engineeringEvidence);
  if (!directAiRelevant && !productMlRelevant) {
    return {
      relevant: false,
      reason: "No clear AI software engineering or product-facing ML evidence.",
      evidence: [],
    };
  }

  const evidence = [aiEvidence ?? productMlEvidence, productEvidence, engineeringEvidence].filter(
    (item): item is RuleEvidence => Boolean(item),
  );
  const uniqueEvidence = evidence.filter(
    (item, index) => evidence.findIndex((candidate) => candidate.quote === item.quote && candidate.reason === item.reason) === index,
  );
  return {
    relevant: true,
    reason: directAiRelevant
      ? "AI/LLM work is paired with engineering evidence."
      : "Product-facing ML deployment is paired with engineering evidence.",
    evidence: uniqueEvidence,
  };
}

function detectEnglish(title: string, description: string): boolean {
  const sample = normalized(`${title}\n${description}`);
  const nonLatinCount = (sample.match(/[\u0600-\u06ff\u0e00-\u10ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/gu) ?? []).length;
  const latinCount = (sample.match(/[a-z]/gu) ?? []).length;
  if (nonLatinCount > Math.max(3, latinCount * 0.08)) return false;
  const foreignCount = FOREIGN_SIGNALS.reduce((count, pattern) => count + (pattern.test(sample) ? 1 : 0), 0);
  if (foreignCount >= 2) return false;
  const englishCount = (sample.match(ENGLISH_SIGNALS) ?? []).length;
  return englishCount >= 2 || (latinCount > 0 && foreignCount === 0);
}

function evaluateLanguage(input: GoldenCase): {
  fit: boolean;
  reason: string;
  evidence: RuleEvidence[];
} {
  const text = `${input.title}\n${input.description}`;
  const saudiEvidence = firstEvidence(
    input.title,
    input.description,
    /\b(?:saudi nationals? only|saudization role|saudised role)\b/iu,
    "Saudi-only exclusion",
  );
  if (saudiEvidence) {
    return {
      fit: false,
      reason: "Saudi-only roles are excluded.",
      evidence: [saudiEvidence],
    };
  }

  for (const rule of LANGUAGE_RULES) {
    const evidence = firstEvidence(input.title, input.description, rule.match, `${rule.name} language mention`);
    if (!evidence) continue;
    const sentence = evidence.quote;
    const optional = rule.optional.test(sentence);
    const strongRequired = rule.strongRequired.test(sentence);
    const levelRequired = rule.levelRequired.test(sentence);
    if (optional && !strongRequired) continue;
    if (strongRequired || levelRequired) {
      return {
        fit: false,
        reason: `${rule.name} is required as a non-English working language.`,
        evidence: [{ ...evidence, reason: "Mandatory non-English language" }],
      };
    }
  }

  const english = detectEnglish(input.title, input.description);
  if (english) {
    const evidence = firstEvidence(input.title, input.description, /.+/u, "English JD text");
    return {
      fit: true,
      reason: "English JD satisfies the working-language rule.",
      evidence: evidence ? [evidence] : [],
    };
  }

  const englishEvidence = firstEvidence(input.title, input.description, new RegExp(ENGLISH_MARKERS.join("|"), "iu"), "English working-language evidence");
  if (englishEvidence) {
    return {
      fit: true,
      reason: "Non-English JD explicitly mentions English as a working language.",
      evidence: [englishEvidence],
    };
  }
  return {
    fit: false,
    reason: "Non-English JD does not mention English as a working language.",
    evidence: [],
  };
}

export function evaluateCase(input: GoldenCase): CaseEvaluation {
  const role = evaluateRole(input);
  const language = evaluateLanguage(input);
  const predictedRelevant = role.relevant && language.fit;
  const outcome = input.label
    ? predictedRelevant
      ? "true_positive"
      : "false_negative"
    : predictedRelevant
      ? "false_positive"
      : "true_negative";
  return {
    ...input,
    roleRelevant: role.relevant,
    languageFit: language.fit,
    predictedRelevant,
    roleReason: role.reason,
    languageReason: language.reason,
    roleEvidence: role.evidence,
    languageEvidence: language.evidence,
    outcome,
  };
}

function emptyMetrics(): Metrics {
  return {
    total: 0,
    actualPositive: 0,
    actualNegative: 0,
    predictedPositive: 0,
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
    precision: null,
    recall: null,
    accuracy: 0,
  };
}

function metricsFor(cases: CaseEvaluation[]): Metrics {
  const metrics = emptyMetrics();
  metrics.total = cases.length;
  for (const item of cases) {
    if (item.label) metrics.actualPositive += 1;
    else metrics.actualNegative += 1;
    if (item.predictedRelevant) metrics.predictedPositive += 1;
    if (item.outcome === "true_positive") metrics.truePositive += 1;
    if (item.outcome === "true_negative") metrics.trueNegative += 1;
    if (item.outcome === "false_positive") metrics.falsePositive += 1;
    if (item.outcome === "false_negative") metrics.falseNegative += 1;
  }
  const predicted = metrics.truePositive + metrics.falsePositive;
  const actual = metrics.truePositive + metrics.falseNegative;
  metrics.precision = predicted > 0 ? metrics.truePositive / predicted : null;
  metrics.recall = actual > 0 ? metrics.truePositive / actual : null;
  metrics.accuracy = metrics.total > 0 ? (metrics.truePositive + metrics.trueNegative) / metrics.total : 0;
  return metrics;
}

function groupMetrics(
  cases: CaseEvaluation[],
  key: (item: CaseEvaluation) => string,
): Record<string, Metrics> {
  const groups = new Map<string, CaseEvaluation[]>();
  for (const item of cases) {
    const group = key(item);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, items]) => [name, metricsFor(items)]));
}

export function evaluateCases(cases: GoldenCase[], path = "in-memory", precisionThreshold = 0.9): EvaluationReport {
  const evaluated = cases.map(evaluateCase);
  const overall = metricsFor(evaluated);
  return {
    path,
    cases: evaluated,
    overall,
    byCountry: groupMetrics(evaluated, (item) => item.country || "UNKNOWN"),
    bySeniority: groupMetrics(evaluated, (item) => inferSeniority(item)),
    precisionThreshold,
    precisionGatePassed: overall.precision !== null && overall.precision >= precisionThreshold,
  };
}

export async function runGoldenEvaluation(
  path = resolve(process.cwd(), "docs/golden/cases.jsonl"),
  precisionThreshold = 0.9,
): Promise<EvaluationReport> {
  const text = await readFile(path, "utf8");
  return evaluateCases(parseGoldenCases(text), path, precisionThreshold);
}

function percentage(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

function metricsRow(name: string, metrics: Metrics): string {
  return [
    name,
    String(metrics.total),
    String(metrics.truePositive),
    String(metrics.falsePositive),
    String(metrics.falseNegative),
    String(metrics.trueNegative),
    percentage(metrics.precision),
    percentage(metrics.recall),
  ].join(" | ");
}

export function formatEvaluationReport(report: EvaluationReport): string {
  const lines = [
    `Golden evaluation: ${report.path}`,
    `Cases: ${report.overall.total} | actual positives: ${report.overall.actualPositive} | predicted positives: ${report.overall.predictedPositive}`,
    "",
    "Group | N | TP | FP | FN | TN | Precision | Recall",
    metricsRow("Overall", report.overall),
    "",
    "By country",
    "Country | N | TP | FP | FN | TN | Precision | Recall",
    ...Object.entries(report.byCountry).map(([name, metrics]) => metricsRow(name, metrics)),
    "",
    "By seniority",
    "Seniority | N | TP | FP | FN | TN | Precision | Recall",
    ...Object.entries(report.bySeniority).map(([name, metrics]) => metricsRow(name, metrics)),
    "",
    `Precision gate: ${report.precisionGatePassed ? "PASS" : "FAIL"} (minimum ${percentage(report.precisionThreshold)})`,
  ];

  const falsePositives = report.cases.filter((item) => item.outcome === "false_positive");
  const falseNegatives = report.cases.filter((item) => item.outcome === "false_negative");
  lines.push("", `False positives (${falsePositives.length})`);
  lines.push(...falsePositives.map((item) => `- ${item.id}: ${item.roleReason} ${item.languageReason}`));
  lines.push("", `False negatives (${falseNegatives.length})`);
  lines.push(...falseNegatives.map((item) => `- ${item.id}: ${item.roleReason} ${item.languageReason}`));
  return lines.join("\n");
}

function readOptions(args: string[]): { path: string; precisionThreshold: number } {
  const thresholdArg = args.find((arg) => arg.startsWith("--min-precision="));
  const threshold = thresholdArg ? Number(thresholdArg.slice("--min-precision=".length)) : 0.9;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("--min-precision must be a number between 0 and 1");
  }
  const positional = args.find((arg) => !arg.startsWith("--"));
  return {
    path: positional ? resolve(process.cwd(), positional) : resolve(process.cwd(), "docs/golden/cases.jsonl"),
    precisionThreshold: threshold,
  };
}

if (import.meta.main) {
  try {
    const options = readOptions(process.argv.slice(2));
    const report = await runGoldenEvaluation(options.path, options.precisionThreshold);
    console.log(formatEvaluationReport(report));
    if (!report.precisionGatePassed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
