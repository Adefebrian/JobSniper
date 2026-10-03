// Brian's like/dislike feedback as a tiny local model: per-word log-odds learned from the titles and
// evidence of liked vs disliked jobs. Jev gets the same examples as context; this model stands in
// when Jev is unreachable and adds a stable signal on top of it.
export type FeedbackExample = { verdict: "like" | "dislike"; title: string; company: string; evidence: string; note: string | null };

const STOP = new Set("the and for with you our are will this that from have your senior staff lead junior engineer engineering software developer team".split(" "));

export function tokens(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []).filter((w) => !STOP.has(w)))];
}

export function preferenceModel(examples: FeedbackExample[]): (text: string) => number | null {
  const likes = examples.filter((e) => e.verdict === "like");
  const dislikes = examples.filter((e) => e.verdict === "dislike");
  if (likes.length + dislikes.length < 2) return () => null;
  const count = (set: FeedbackExample[]) => {
    const map = new Map<string, number>();
    for (const e of set) for (const t of tokens(`${e.title} ${e.evidence} ${e.note ?? ""}`)) map.set(t, (map.get(t) ?? 0) + 1);
    return map;
  };
  const like = count(likes);
  const dislike = count(dislikes);
  return (text: string) => {
    let logit = Math.log((likes.length + 1) / (dislikes.length + 1));
    for (const t of tokens(text)) {
      const l = like.get(t) ?? 0;
      const d = dislike.get(t) ?? 0;
      if (l || d) logit += Math.log((l + 1) / (likes.length + 2)) - Math.log((d + 1) / (dislikes.length + 2));
    }
    return 1 / (1 + Math.exp(-logit));
  };
}

const AGENTIC = /\b(agentic|ai[- ]agents?|agents?\b|ai[- ]assisted|copilot|cursor|claude code|codex|llm|large language model|genai|generative ai|rag|tool[- ]use|function calling|prompt)/gi;

/** Local stand-in for Jev's agentic_focus: share of AI-assisted/agentic signals in title + JD. */
export function localAgenticFocus(title: string, jd: string): number {
  const inTitle = AGENTIC.test(title);
  AGENTIC.lastIndex = 0;
  const hits = (jd.match(AGENTIC) ?? []).length;
  if (inTitle) return 0.9;
  return Math.min(0.85, 0.35 + hits * 0.08);
}
