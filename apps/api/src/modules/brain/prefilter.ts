import type { Evidence } from "../../core/domain";

export type PrefilterResult = {
  pass: boolean;
  reason?: string | undefined;
  evidence: Evidence[];
  language: "english" | "non_english";
  languageEvidence: Evidence[];
};

const ROLE_TERMS = [
  "ai engineer",
  "artificial intelligence",
  "llm",
  "large language model",
  "genai",
  "generative ai",
  "applied ai",
  "agentic",
  "ai-assisted",
  "ai assisted",
  "machine learning",
  "ml engineer",
];

const PRODUCT_ML_TERMS = [
  "deploy model",
  "production model",
  "model deployment",
  "product-facing",
  "product facing",
  "mlops",
  "machine learning platform",
];

const ENGINEERING_TERMS = [
  "software engineer",
  "software developer",
  "fullstack",
  "full stack",
  "backend",
  "back-end",
  "platform engineer",
  "product engineer",
];

const DISQUALIFIED_TERMS = [
  "graduate",
  "new grad",
  "new graduate",
  "intern",
  "internship",
  "apprentice",
  "ai trainer",
  "data annotator",
  "data labeling",
  "data labelling",
  "research scientist",
  "sales engineer",
  "marketing",
  "recruiter",
];

const ENGLISH_MARKERS = [
  "english",
  "englisch",
  "anglais",
  "inglés",
  "ingles",
  "inglese",
  "engels",
  "الإنجليزية",
  "الانجليزية",
  "英語",
  "英语",
  "영어",
];

const REQUIRED_OTHER_LANGUAGE = [
  "german c1 required",
  "german c2 required",
  "deutsch verhandlungssicher",
  "fluent german required",
  "korean business level",
  "fluent french required",
  "arabic native",
  "native arabic",
  "japanese native",
  "日本語ネイティブ",
  "mandarin required",
  "fluent dutch required",
  "nederlands vereist",
  "chinois exigé",
  "spanish required",
];

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function sentenceEvidence(text: string, needle: string, source: string, reason: string): Evidence | undefined {
  const lower = text.toLowerCase();
  const index = lower.indexOf(needle.toLowerCase());
  if (index < 0) return undefined;
  const start = Math.max(0, text.lastIndexOf(".", index) + 1);
  const period = text.indexOf(".", index + needle.length);
  const end = period < 0 ? text.length : period + 1;
  return { quote: text.slice(start, end).trim(), source, reason };
}

export function detectJobLanguage(title: string, jdText: string): "english" | "non_english" {
  const sample = normalized(`${title}\n${jdText.slice(0, 3_000)}`);
  const commonEnglish = [" the ", " and ", " you ", " will ", " experience", " team", " role", " work"];
  const score = commonEnglish.reduce((sum, term) => sum + (sample.includes(term) ? 1 : 0), 0);
  return score >= 3 ? "english" : "non_english";
}

export function languagePrefilter(title: string, jdText: string): {
  pass: boolean;
  reason?: string;
  language: "english" | "non_english";
  evidence: Evidence[];
} {
  const text = `${title}\n${jdText}`;
  const sample = normalized(text);
  const language = detectJobLanguage(title, jdText);
  const englishMarker = ENGLISH_MARKERS.find((marker) => sample.includes(normalized(marker)));
  const evidence: Evidence[] = [];

  if (/saudi nationals? only|saudization role|saudised role/.test(sample)) {
    const quote = sentenceEvidence(text, /saudi nationals? only|saudization role|saudised role/i.source, "JD", "Saudi-only role") ??
      { quote: title, source: "title", reason: "Saudi-only role" };
    return { pass: false, reason: "Saudi-only roles are excluded.", language, evidence: [quote] };
  }

  const requiredLanguage = REQUIRED_OTHER_LANGUAGE.find((term) => sample.includes(term));
  if (requiredLanguage) {
    const quote = sentenceEvidence(text, requiredLanguage, "JD", "Another language is required") ??
      { quote: title, source: "title", reason: "Another language is required" };
    return { pass: false, reason: "A language other than English is required.", language, evidence: [quote] };
  }

  if (language === "english") {
    const quote = sentenceEvidence(jdText, normalized(jdText.slice(0, 24)) || normalized(title), "JD", "English JD") ??
      { quote: title, source: "title", reason: "English JD" };
    evidence.push(quote);
    return { pass: true, language, evidence };
  }

  if (!englishMarker) {
    return {
      pass: false,
      reason: "Non-English JD does not mention English as a working language.",
      language,
      evidence: [{ quote: jdText.slice(0, 240), source: "JD", reason: "No English working-language evidence" }],
    };
  }

  const quote = sentenceEvidence(text, englishMarker, "JD", "English working language mentioned") ??
    { quote: title, source: "title", reason: "English working language mentioned" };
  evidence.push(quote);
  return { pass: true, language, evidence };
}

export function prefilterJob(input: { title: string; jdText: string }): PrefilterResult {
  const { title, jdText } = input;
  const text = `${title}\n${jdText}`;
  const sample = normalized(text);
  const disqualified = DISQUALIFIED_TERMS.find((term) => sample.includes(term));
  if (disqualified) {
    return {
      pass: false,
      reason: `Disqualified role term: ${disqualified}`,
      evidence: [],
      language: detectJobLanguage(title, jdText),
      languageEvidence: [],
    };
  }

  const roleTerm = ROLE_TERMS.find((term) => sample.includes(term));
  const productMl = PRODUCT_ML_TERMS.some((term) => sample.includes(term));
  const engineering = ENGINEERING_TERMS.some((term) => sample.includes(term));
  const relevant = Boolean(roleTerm) || (productMl && engineering);
  if (!relevant) {
    return {
      pass: false,
      reason: "No clear AI software engineering evidence.",
      evidence: [],
      language: detectJobLanguage(title, jdText),
      languageEvidence: [],
    };
  }

  const evidenceTerm = roleTerm ?? PRODUCT_ML_TERMS.find((term) => sample.includes(term)) ?? title;
  const evidence = [
    sentenceEvidence(text, evidenceTerm, normalized(title).includes(normalized(evidenceTerm)) ? "title" : "JD", "AI-SWE relevance") ??
      { quote: title, source: "title", reason: "AI-SWE relevance" },
  ];
  const language = languagePrefilter(title, jdText);
  return {
    pass: language.pass,
    reason: language.reason,
    evidence,
    language: language.language,
    languageEvidence: language.evidence,
  };
}
