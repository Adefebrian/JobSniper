# Golden evaluation set

Each JSONL case stores:

```json
{
  "id": "stable-id",
  "title": "AI Software Engineer",
  "description": "Exact public job text",
  "country": "SG",
  "label": true,
  "reason": "Product-facing AI development is explicit in the description."
}
```

The committed `cases.jsonl` is a deterministic 100-case seed used by focused evaluation tests. It covers every PRD target country (SG, AU, NZ, US, UK, CA, CH, DE, AE, QA, and SA), plus GLOBAL and neutral-country cases (JP, NL, FR, ES, IN, ID, BR, and KR). Cases exercise AI-SWE titles, product-facing ML, excluded roles, English and non-English JDs, optional versus mandatory languages, Saudi-only exclusions, sponsorship states, remote scopes, and all seniority buckets.

The current seed contains 67 positive and 33 negative labels. Evaluation output reports precision, recall, false positives, and false negatives by country and seniority; the required precision gate remains 90%.
