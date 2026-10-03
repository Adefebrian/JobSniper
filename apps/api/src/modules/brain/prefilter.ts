// Free first pass (PRD 7.1, 3.1, 3.4). Drops obvious misses before any paid call and keeps the
// verbatim evidence every target must carry. Disqualifiers look at the TITLE only: scanning the
// whole JD for "intern" or "graduate" would hit "internal", "international", "graduate degree".
import type { Evidence } from "@core/domain";

export type PrefilterResult = {
  pass: boolean;
  reason?: string | undefined;
  evidence: Evidence[];
  language: "english" | "non_english";
  languageEvidence: Evidence[];
};

const EXCLUDED_TITLE =
  /(\bintern(ship)?\b|\bgraduate\b|new grad|apprentice|\btrainee\b|working student|werkstudent|\bstudent\b|annotat|label(l)?ing|ai trainer|\btutor\b|\bsales\b|marketing|recruit|account executive|customer success|\bphd\b|research scientist)/i;
// Engineering titles outside software (or outside AI-SWE scope) per PRD 3.1.
const NON_SWE_TITLE =
  /(designer|manufactur|mechanical|electrical|civil|hardware|firmware|legal|finance|accounting|support engineer|customer engineer|security engineer|quality engineer|test engineer|qa engineer|analytics engineer|network engineer|field engineer|sales engineer|solutions? consultant|technical writer|it engineer|systems administrator)/i;
const ENGINEERING_TITLE =
  /(engineer|engineering|developer|programmer|\bswe\b|software|full[- ]?stack|back[- ]?end|front[- ]?end|architect|\bdevops\b|\bmlops\b|\bsre\b|entwickler)/i;
const AI_TITLE = /\b(ai|a\.i\.|ki|ml|llms?|genai|nlp|agentic|agents?)\b/i;
const AI_CASE = /\b(AI|ML|LLMs?|RAG|NLP|GenAI|MLOps)\b/;
const AI_WORDS =
  /\b(artificial intelligence|large language models?|generative ai|gen ai|machine learning|deep learning|agentic|ai[- ]agents?|ai[- ]assisted|ai[- ]powered|ai[- ]native|ai[- ]first|retrieval[- ]augmented|prompt engineering|foundation models?|computer vision|copilot|claude code|langchain|llamaindex|vector (?:database|search|store)|openai|anthropic|gpt-?\d?)\b/i;

const ENGLISH_MARKER =
  /(english|englisch|anglais|ingl[eé]s|inglese|engels|engelsk|angielski|ingilizce|ingl[eê]s|الإنجليزية|الانجليزية|영어|英語|英语|английск)/i;
const OTHER_LANGUAGE =
  /\b(german|deutsch|french|fran[cç]ais|arabic|korean|japanese|mandarin|chinese|cantonese|dutch|spanish|italian|portuguese|swedish|danish|norwegian|finnish|polish|turkish|hebrew)\b/i;
const REQUIRED_OTHER_LANGUAGE =
  /\b(german|deutsch|french|fran[cç]ais|arabic|korean|japanese|mandarin|chinese|dutch|spanish|italian|portuguese|swedish|danish|norwegian|polish|turkish)\b[^.\n]{0,50}\b(required|native|fluent|mandatory|c1|c2|business[- ]level|verhandlungssicher|flie(ß|ss)end)\b/i;
const MERELY_A_PLUS = /\b(plus|preferred|nice to have|bonus|advantage|von vorteil|wünschenswert)\b/i;
const SAUDI_ONLY = /saudi nationals? only|saudization role|saudised role/i;
const EN_STOP = new Set(
  "the and to of a in you we with for is our will are on as be this your or an at by from that have".split(" "),
);

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectJobLanguage(title: string, jdText: string): "english" | "non_english" {
  const text = jdText.trim() ? jdText.slice(0, 6_000) : title;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return "english";
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (latin / letters < 0.6) return "non_english";
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 15) return "english";
  const stop = words.filter((w) => EN_STOP.has(w)).length;
  return stop / words.length >= 0.08 ? "english" : "non_english";
}

function clip(s: string): string {
  return s.length > 280 ? `${s.slice(0, 277)}...` : s;
}

export function aiEvidence(title: string, jdText: string): Evidence[] {
  const out: Evidence[] = [];
  if (AI_TITLE.test(title) || AI_CASE.test(title) || AI_WORDS.test(title)) {
    out.push({ quote: title, source: "title", reason: "AI in the job title" });
  }
  for (const s of sentences(jdText)) {
    if (out.length >= 3) break;
    if (AI_CASE.test(s) || AI_WORDS.test(s)) out.push({ quote: clip(s), source: "JD", reason: "AI in the job description" });
  }
  return out;
}

export function languageEvidence(jdText: string): Evidence[] {
  return sentences(jdText)
    .filter((s) => OTHER_LANGUAGE.test(s) || SAUDI_ONLY.test(s) || ENGLISH_MARKER.test(s))
    .slice(0, 4)
    .map((s) => ({ quote: clip(s), source: "JD", reason: "Language or nationality mention" }));
}

/** Language gate only (PRD 3.4): English JD passes; another language must mention English. */
export function languagePrefilter(title: string, jdText: string) {
  const language = detectJobLanguage(title, jdText);
  if (language === "non_english" && !ENGLISH_MARKER.test(jdText)) {
    return { pass: false, reason: "Non-English JD does not mention English as a working language.", language, evidence: [] as Evidence[] };
  }
  return { pass: true, reason: undefined, language, evidence: languageEvidence(jdText) };
}

export function prefilterJob(input: { title: string; jdText: string }): PrefilterResult {
  const title = input.title.trim();
  const jdText = input.jdText ?? "";
  const language = detectJobLanguage(title, jdText);
  const fail = (reason: string): PrefilterResult => ({ pass: false, reason, evidence: [], language, languageEvidence: [] });

  if (EXCLUDED_TITLE.test(title)) return fail(`Excluded title: ${title}`);
  if (!ENGINEERING_TITLE.test(title)) return fail("Not an engineering title.");
  if (NON_SWE_TITLE.test(title) && !AI_TITLE.test(title)) return fail(`Outside AI software engineering: ${title}`);
  if (language === "non_english" && !ENGLISH_MARKER.test(jdText)) {
    return fail("Non-English JD does not mention English as a working language.");
  }
  if (SAUDI_ONLY.test(jdText)) return fail("Saudi-only role.");
  const required = REQUIRED_OTHER_LANGUAGE.exec(jdText);
  if (required && !MERELY_A_PLUS.test(required[0])) {
    return fail(`Requires a language other than English: "${required[0]}"`);
  }
  const evidence = aiEvidence(title, jdText);
  if (evidence.length === 0) return fail("No AI evidence in the title or description.");
  return { pass: true, evidence, language, languageEvidence: languageEvidence(jdText) };
}
