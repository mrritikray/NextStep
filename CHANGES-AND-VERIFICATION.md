# NextStep — Dynamic Features Implementation & Verification

This is the **existing NextStep project, modified in place**. No rebuild from scratch, the
current UI/design is untouched (same layout, `ns-*` classes and `--ns-*` colour tokens), and
the existing **SQLite** database + **Gemini** integration are the only data/AI layers used.

---

## 1. What was implemented

### 1. Dynamic Overview roadmap progress
* New endpoint `roadmap.progress` returns `{ total, completed, remaining, percent }` for the
  **current** learning roadmap, computed from `roadmap_items.completed` (nothing hard-coded).
* Overview now renders a **Roadmap Progress** panel with four live numbers — Total tasks,
  Completed, Remaining, Progress % — plus the existing metric card, which now reads the same
  live values (`N/M` and `% complete · N remaining`).
* Because the roadmap is regenerated for every new opportunity, the Overview statistics change
  automatically with it (verified: 7 tasks → complete 1 → 7 total / 1 completed / 6 remaining / 14 %).

### 2. Learning resources per roadmap task (with language choice)
* Every roadmap task card now has a **“Find Learning Resources”** button.
* Clicking it opens a language picker (English, Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi,
  Kannada, Malayalam, Gujarati, Punjabi, Urdu) → selected language drives the search.
* Backend `roadmap.findResources` calls **Gemini** (when `GEMINI_API_KEY` is set) with a strict
  prompt + JSON schema asking for YouTube videos, YouTube playlists, free courses and learning
  websites for that exact skill, preferring the chosen language.
* **No invented URLs:** every URL Gemini returns is checked with a live HTTP request server-side
  before it is stored/shown; dead links are dropped. If Gemini returns too few verifiable links
  (or there is no API key, i.e. demo mode) a curated catalogue of real, stable resources is used
  (official docs, freeCodeCamp, NPTEL, SWAYAM, Microsoft Learn, Kaggle Learn, The Odin Project,
  real YouTube channels, plus YouTube *search* URLs — never guessed video IDs). Each stored link
  carries a `verified` flag that the UI displays.
* Results are grouped by kind, open in a **new tab** (`target="_blank" rel="noopener noreferrer"`),
  and are persisted in the new `learning_resources` table so they survive refresh/restart.
* The chosen language is saved (`resource_language`) and reused for every future search.

### 3. Dynamic greeting
* The Overview greeting is computed from the user's local clock in the browser:
  `Good Morning` (< 12), `Good Afternoon` (< 17), `Good Evening` (< 21), `Good Night` (≥ 21).

### 4. Saved Data / Opportunity History
* New tables/columns and repository logic archive a **complete snapshot** of the outgoing
  opportunity before switching: job details, match %, skill gaps, analysis, roadmap (+ every
  task and its completion), progress numbers, applications + statuses, rejection feedback.
* The **main profile is never snapshotted or duplicated** — it stays shared and independent
  (verified in tests: the full profile object is byte-identical before/after a switch).
* Analyzing a new opportunity: archives the current one → makes the new one current → **builds
  its roadmap immediately** → Overview, Skill Analysis and Roadmap all reflect the new role.
* New **“Saved Data”** section in the sidebar (route `/app/history`) lists every previous
  opportunity with match %, tasks completed/total, progress %, application status and rejection
  note, and offers **Switch & restore** (roadmap, order, progress and history come back exactly)
  and **Delete**.

### 5. Roadmap task order is stable
* Roadmap items keep an explicit `position` and their own ids. Completing a task only flips a
  status flag — items are never renamed or re-indexed (verified by comparing id/position/title
  arrays before and after completion).
* Restoring a saved opportunity re-applies completion **by position**, so order and ids stay
  identical. Regenerating a plan carries completion forward for identical steps.

### 6. Delete opportunities (with confirmation)
* Delete button on each saved opportunity (Opportunities list + Saved Data cards), always behind
  a confirmation dialog that explains exactly what is removed.
* `opportunity.delete` cascades: analyses, roadmaps + items + resources, applications + feedback,
  saved snapshot. The **profile and global skills are never touched** (verified in tests).

### 7. Application tracker — after interview
* When an application is in **Interview**, the card shows two options: **Rejection** and
  **Selection** (the old silent auto-advance to “Selected” is gone).
* **Rejection** → dialog with “Add rejection reason” and “Skip”.
  * Reason: saved on the application, analysed (Gemini when available) and stored as feedback,
    included in the opportunity snapshot, and accumulated into `stats.rejectionSkills` /
    “Learned from rejections” insight that feeds future roadmap prioritisation.
  * Skip: saved as rejected without a reason and shows “Add new opportunities to continue your
    journey.”
* **Selection** → congratulatory message, status set to **Selected**, a `selection` success
  notification is created, and the win is saved in opportunity history.

### 8. One source of truth
`Profile → Opportunities → Current opportunity → Skill gaps → Roadmap → Task progress →
Applications → Feedback → Saved history → Overview` all read from the same SQLite rows through
`server/db/repositories.ts`; the “current opportunity” pointer (`app_meta.current_opportunity_id`)
is what every dependent view resolves against, and mutations refresh the affected queries and the
stored snapshot.

---

## 2. Files changed / added

**Server**
| File | Change |
|---|---|
| `server/db/sqlite.ts` | New tables `opportunity_snapshots`, `learning_resources`; forward migrations (`applications.rejection_reason`, `applications.outcome`, indexes). |
| `server/db/repositories.ts` | Current-opportunity pointer, roadmap progress, snapshots (save/list/get/restore), cascade delete, learning-resource storage, rejection accumulation; `rejectionReason`/`outcome` mapping. |
| `server/services/learningResources.ts` | **New** — Gemini resource search, curated real-resource catalogue, live URL verification, language handling. |
| `server/services/prompts.ts` | **New** `RESOURCE_SCHEMA` + `buildLearningResourcePrompt` (strict URL honesty rules). |
| `server/services/types.ts` | New types (`LearningResource`, `RoadmapProgress`, `OpportunitySnapshot`, …), notification types, extended insight stats. |
| `server/services/aiService.ts` | `generateInsights` accepts accumulated rejection signals and surfaces a “Learned from rejections” insight. |
| `server/routers.ts` | `roadmap.progress`, `roadmap.itemResources`, `roadmap.resourcePreference`, `roadmap.setResourcePreference`, `roadmap.findResources`; `opportunity.current`, `opportunity.history`, `opportunity.switch`, `opportunity.delete`; `application.resolveAfterInterview`; auto roadmap + snapshot on analysis; dynamic `insights.get` stats. |
| `server/nextstep.features.test.ts` | **New** — end-to-end verification suite (real procedures + real SQLite, restart check). |

**Client**
| File | Change |
|---|---|
| `client/src/components/nextstep/NextStepDynamic.tsx` | **New** — `RoadmapProgressPanel`, `RoadmapStepResources`, `OpportunityHistoryView`, `AfterInterviewPanel`, `OpportunityDeleteButton` (existing design language). |
| `client/src/pages/Home.tsx` | Saved Data nav + route, dynamic greeting, roadmap progress panel & live metric, per-task resource finder, after-interview panel, delete action, wider query invalidation. |

---

## 3. Verification

`npx tsc --noEmit` → clean. `npx vite build` → success (new UI present in the bundle).

`npx vitest run server/nextstep.features.test.ts` → **passed** (real backend, real SQLite):

| Check | Result |
|---|---|
| New opportunity → new roadmap generated automatically | ✅ 7-item roadmap for the role |
| Overview counts (total/completed/remaining/%) | ✅ 7 / 0 / 7 / 0 % → after 1 task: 7 / 1 / 6 / 14 % |
| Complete task → counts update everywhere | ✅ `roadmap.progress` + `insights.get` stats agree |
| Task order never changes | ✅ id + position + title arrays identical after completion |
| New opportunity → previous archived, new roadmap current | ✅ 2 snapshots, current = new role |
| Switch back → roadmap/order/progress/analysis restored | ✅ 1/7 restored, ids identical |
| Profile untouched by switching/analysis/deletion | ✅ profile object unchanged |
| Resource language selection + persistence | ✅ “Hindi” saved and reused |
| Resource links real & saved | ✅ 8 stored resources, all `https://`, ≥2 kinds, re-search idempotent |
| Rejection + reason | ✅ status Rejected, reason stored, feedback analysed, insights updated |
| Rejection + skip | ✅ Rejected without reason + “Add new opportunities…” message |
| Selection + notification | ✅ status Selected, `selection` notification created |
| Delete opportunity | ✅ history/roadmap/application removed, profile + skills kept |
| Refresh/restart persistence | ✅ database reopened: history, progress, current roadmap, language, resources and profile identical |

---

## 4. Running it

```bash
cp .env.example .env      # optional: add GEMINI_API_KEY for real AI mode
npm install               # (dependencies are NOT included in this archive)
npm run dev               # http://localhost:5000 (falls back to the next free port)
```

* With `GEMINI_API_KEY` empty the app runs in **demo mode** (deterministic local analysis) — this
  is how the tests above were run. Add a key and restart for real Gemini analyses, roadmap
  generation and resource suggestions.
* The SQLite file is created automatically at `server/data/nextstep.db`; `npm run db:reset`
  recreates it.

---

## Gemini token optimisation (single-request resume analysis)

See `TOKEN-OPTIMIZATION.md` for the full breakdown and the executed verification.

- `resume.analyze` now makes ONE Gemini request (was 2 — the resume text was sent twice).
- Job extraction + trust check share ONE request; resume rewrite + change list share ONE request.
- Learning resources are cached per skill + language and reused with zero Gemini calls.
- Every request logs operation, input-token estimate and response size; every user action logs its
  Gemini call count (`[AI-Usage]`), and `service.usage` exposes the recent tallies.
- Verified: `npx vitest run` 14/14 tests pass, `npx tsc --noEmit` clean,
  `npx tsx scripts/verify-token-usage.ts` -> PASS (1 call, resume text sent once).
