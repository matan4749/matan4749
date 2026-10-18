# Jobbot

אוטומציית חיפוש והגשת משרות מקומית עבור **מתן עמר** · Local desktop job-application automation.

UI: **עברית (RTL)** · Electron + React + Playwright + site adapters + learning KB + **built-in email**.

## Quick start / התחלה מהירה

```bash
cd jobbot
npm install
npx playwright install chromium
JOBBOT_DEMO=1 npm run dev
```

Headless demo (no window):

```bash
npx tsx scripts/demo-run.ts
```

## קורות חיים / CV

Default CV is already wired:

| Source | Path |
|--------|------|
| Project store (canonical) | `/cursor/stores/self/cv/matan-amar-cv.pdf` |
| Bundled in app | `jobbot/assets/cv/matan-amar-cv.pdf` |

On first launch the app seeds a copy into its data dir and sets `cvPath` automatically. Used for **CV-based keyword matching** and **file uploads** on apply flows. Override anytime in **הגדרות**.

## Chrome profile (no passwords)

1. Open the site list in Settings (LinkedIn, Indeed, boards, Elbit, IAI…).
2. Log into those sites yourself in Chrome.
3. Quit Chrome fully.
4. Set **Chrome user-data-dir** in Jobbot settings.

Jobbot never asks for site passwords — it reuses your logged-in profile via Playwright persistent context.

## Built-in email (no user SMTP)

You only set the **destination address** in Settings (`reportEmail`).

Sending uses an **app-owned** mailer:

1. Resend API via `JOBBOT_MAIL_API_KEY` + `JOBBOT_MAIL_FROM`, or
2. App SMTP relay via `JOBBOT_MAIL_SMTP_*` (maintainer env — not shown in UI).

Every report is also saved under `outbox/` + shown in the **דוח** tab.

## Sites

**Boards:** LinkedIn (live), Indeed (live), AllJobs / Drushim / GotFriends (stubs).

**Company career portals:** אלביט / Elbit Systems, תעשייה אווירית / IAI (stubs + learning hooks).

## Search modes

1. **מילות מפתח** — pick all or a subset.
2. **מקו״ח** — analyze Matan’s CV → suggested keywords → search.

## Learning

Failures update a local knowledge base for the next run. See [`docs/LEARNING.md`](docs/LEARNING.md).

## Scripts

| Command | Meaning |
|---------|---------|
| `npm run dev` | Electron + Vite |
| `JOBBOT_DEMO=1 npm run dev` | Demo mode |
| `npm run demo:run` | Headless demo |
| `npm run typecheck` | TypeScript |

Plan: Project store `docs/jobbot-plan.md`.
