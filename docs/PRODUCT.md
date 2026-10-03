# JobSniper product contract

JobSniper is a local, single-user system for discovering open AI software engineering roles from public career pages and ATS feeds, scoring them against Brian's profile, preparing grounded English applications, and sending only after per-email approval.

Hard rules:

- Public access only: no login, CAPTCHA bypass, protected scraping, or guessed email.
- Every relevant job stores exact AI evidence; every non-English JD stores language evidence.
- English is the working language. Other languages are allowed only when optional or clearly non-required.
- Remote global/APAC roles rank highest. Restricted remote roles remain available at lower priority.
- Sponsorship is read from the job description and is never overwritten by sponsor registries.
- LLM spend stops at the configured monthly cap while crawling continues.
- No unverified job is ever sent.
- Dashboard binds to `127.0.0.1`, refreshes without sockets, and shows operational failures.
- Development stays lean: focused unit/API tests and one browser smoke test at the end.
