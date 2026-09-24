# NextStep — Gemini token optimisation

**Status: implemented and verified.** One resume analysis is now **ONE Gemini request** (was two); the
job description is sent once per opportunity pass instead of twice; repeated learning-resource
searches cost **zero** Gemini calls. No UI, feature or behaviour was removed, and Gemini REAL mode is
untouched.

---

## 1. What was duplicated before

| User action | Gemini calls BEFORE | Duplication |
|---|---|---|
| Resume analysis (`resume.analyze`) | 2 | `analyzeResume` + `extractProfileFromResume` ran in `Promise.all` — **the complete resume text was posted twice** |
| Resume improvement (`resume.improve`) | 2 | rewrite, then the rewritten resume was posted **back** to Gemini for a change summary |
| Tailored resume (`application.prepare`) | 2 | same rewrite + change-summary round trip |
| Opportunity analysis (`opportunity.analyzeText` / `analyzeImage`) | 3 | job extraction, then the **same posting text again** for the trust check, then the skill-gap notes |
| Learning resources (`roadmap.findResources`) | 1 per click | every click regenerated resources for the same skill + language |

## 2. What changed

| File | Change |
|---|---|
| `server/services/prompts.ts` | New combined schemas + prompts: `RESUME_FULL_SCHEMA` / `buildUnifiedResumePrompt` (analysis **and** profile extraction in one response), `RESUME_REWRITE_SCHEMA` / `buildResumeRewritePrompt` (rewrite **and** change list in one response), `JOB_WITH_TRUST_SCHEMA` / `buildJobExtractionWithTrustPrompt` (requirements **and** trust indicators in one response). All legacy schemas/prompts are kept. |
| `server/services/aiService.ts` | New `analyzeResumeFull()` — one request fanning out to analysis + profile + the convenience fields (strengths, weaknesses, improvements, education, experience, projects, skills, certifications). `improveResume` / `generateTailoredResume` now use the combined rewrite schema. `extractJobRequirements` also returns the trust check; `analyzeOpportunity` accepts it instead of calling Gemini again. Deterministic match % / gap maths in `matching.ts` is untouched. |
| `server/services/aiUsage.ts` *(new)* | Per-call and per-user-action token accounting via `AsyncLocalStorage`. |
| `server/services/gemini.ts` | Reports every request to `aiUsage` (real `usageMetadata.promptTokenCount` when the API returns it, `chars/4` otherwise), plus an optional `GEMINI_BASE_URL` override used only by the verification harness. |
| `server/_core/trpc.ts` | One middleware wraps every **mutation** in an AI-usage scope labelled with the procedure path. |
| `server/db/repositories.ts` | `findReusableLearningResources(skill, language)` — the resource cache lookup. |
| `server/routers.ts` | `resume.analyze` now calls `analyzeResumeFull` once; opportunity flows pass `verification: trust`; `roadmap.findResources` reuses cached skill+language resources before ever calling Gemini; new `service.usage` query exposing the recent per-action tallies. |
| `scripts/verify-token-usage.ts` *(new)* | Counting-stub harness proving the call counts. |
| `server/services/tokenUsage.test.ts` *(new)* | Regression tests for the same guarantees. |

## 3. After

| User action | Gemini calls AFTER | Notes |
|---|---|---|
| Resume analysis | **1** | resume text transmitted once; analysis + profile + all listed fields from that single response |
| Resume improvement / tailored resume | **1** | change list returned with the rewrite; local diff as fallback |
| Opportunity analysis (text or screenshot) | 2 | 1 combined extraction+trust request, 1 skill-gap-notes request (sends only skill names, no posting text); roadmap is a separate feature with its own action |
| Learning resources | **0** on cache hit | resources are stored per skill + language and reused (verified links kept as-is) |

## 4. Server logging

Every Gemini request:

```
[AI-Usage] gemini · operation=analyzeResumeFull · model=gemini-2.5-flash · attempt=1 ·
input≈1200 tok (2826 chars, api) · output≈350 tok (1546 chars) · 24ms · call#1 of action=resume.analyze
```

Every user action:

```
[AI-Usage] action=resume.analyze · geminiCalls=1 · inputTokens≈1200 (api) · responseChars=1546 ·
durationMs=310 · breakdown=analyzeResumeFull×1
```

Cache hits are logged with `geminiCalls=0`. The same tally is available at `service.usage`.

## 5. Verification (actually executed)

`npx vitest run` → **14/14 tests pass** (4 new token-usage tests + the 10 pre-existing ones), and
`npx tsc --noEmit` is clean.

`npx tsx scripts/verify-token-usage.ts` (real service code pointed at a request-counting stub):

```
┌─────────┬──────────────────────────────────────────────────────────┬─────────────┬──────────────────┬──────────────┐
│ (index) │ action                                                   │ geminiCalls │ resumeCopiesSent │ payloadChars │
├─────────┼──────────────────────────────────────────────────────────┼─────────────┼──────────────────┼──────────────┤
│ 0       │ resume analysis — OLD flow (2 calls)                     │ 2           │ 2                │ 5856         │
│ 1       │ resume analysis — NEW flow (analyzeResumeFull)           │ 1           │ 1                │ 5180         │
│ 2       │ opportunity pass (extract+trust, match enrichment)       │ 1           │ 0                │ 522          │
│ 3       │ resume improvement (rewrite + change list)               │ 1           │ 1                │ 2883         │
└─────────┴──────────────────────────────────────────────────────────┴─────────────┴──────────────────┴──────────────┘

PASS: one resume analysis = one Gemini request, resume text sent once.
```

A single resume is not truncated or thinned to hit these numbers: the caps stay at 20,000 characters
for the resume and 12,000 for a posting, exactly as before — no resume information is dropped to save
tokens. Savings grow with the resume length: at the 20,000-character cap the resume analysis sends
about **half** the previous input for the same output.

## 6. Reproduce

```bash
npm install --legacy-peer-deps
npx vitest run
npx tsx scripts/verify-token-usage.ts
```

The counters work against real Gemini too — with `GEMINI_API_KEY` set, run the app and watch the
`[AI-Usage]` lines; the call count for one `resume.analyze` action must stay `1`.
