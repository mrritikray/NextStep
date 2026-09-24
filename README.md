# NextStep — AI-powered career development for students and freshers

NextStep walks a student through one loop: **Profile → Match → Skill Gap → Learn → Apply → Feedback → Improve**.
It is not a chatbot — every AI action is attached to a normal product action (resume analysis,
profile extraction, opportunity analysis, skill matching, roadmap, application preparation,
rejection feedback).

The frontend is the original Manus-generated NextStep interface. What changed is everything
behind it: a real local SQLite database, real file processing, a real centralised Gemini
service, and a deterministic, explainable matching engine.

## Run locally (Windows / macOS / Linux)

```bash
npm install --legacy-peer-deps      # or: pnpm install
cp .env.example .env                # then add your GEMINI_API_KEY (optional)
npm run dev                         # http://localhost:5000
```

`PORT`, `GEMINI_API_KEY`, `GEMINI_MODEL` and `DATABASE_PATH` are all read from `.env`.

Production build:

```bash
npm run check        # tsc --noEmit
npm run test         # vitest
npm run build
npm run start
```

## Two modes

| | When | Behaviour |
|---|---|---|
| **Real AI** | `GEMINI_API_KEY` is set and valid | Every AI operation calls Gemini. A real Gemini failure is surfaced as an error — never disguised as a result. |
| **Demo mode** | `GEMINI_API_KEY` is blank | Deterministic local analysis derived from the actual resume text / job description. The app stays fully usable. |

The mode is decided **server-side** and exposed read-only via `service.mode`. The API key never
reaches the browser.

## Database

Local **SQLite via better-sqlite3**. No Firebase, Supabase, MongoDB, PostgreSQL or MySQL.
The file defaults to `server/data/nextstep.db` (override with `DATABASE_PATH`) and every table
is created automatically on boot. Tables: `profiles`, `resumes`, `opportunities`,
`opportunity_analyses`, `roadmaps`, `roadmap_items`, `applications`, `feedback`.

The legacy MySQL `DATABASE_URL` from the Manus scaffold is no longer used.

See `IMPLEMENTATION_NOTES.md` for the full architecture and the verification log.
