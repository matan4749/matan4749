# Jobbot test report / דוח בדיקות
**Date:** 2026-10-19 · **Branch:** `cursor/jobbot-desktop-app-4bd4` · **Commit under test + follow-up tests**

## Summary / סיכום

| Suite | Pass | Fail |
|-------|------|------|
| Automated `npm test` | **11** | **0** |
| `npm run typecheck` | **pass** | — |
| `npm run demo:run` (honest demo) | **pass** (`applied: 0`) | — |
| `npm run lint` | — | **N/A** (no lint script) |
| Real LinkedIn / Indeed apply (cloud) | — | **Not runnable** (no Matan Chrome session) |

**Verdict:** Automated reliability + clone + demo smoke are green. Real Mac Chrome / LinkedIn Easy Apply remains a **manual** check for Matan.

---

## מה עבר / What passed

### 1. Reliability (6)
- `demoApply` never returns `applied`
- All registered adapters are `live` (AllJobs/Drushim/Elbit/IAI no longer stubs)
- Board/portal demo paths never return `applied`
- Sanitize strips fake `applied` from demo
- `applied` without `confirmed` → `unknown`
- Only confirmed non-simulated counts as real

### 2. Chrome lock mapping (2)
- Detects SingletonLock / existing session / Target closed / Hebrew «פתיחה בסשן קיים»
- Maps to Hebrew Cmd+Q message (`CHROME_QUIT_MSG_HE`)

### 3. Profile clone without real Chrome (2)
- `shouldCopyPath` skips SingletonLock/Cookie/Socket + Cache dirs
- Temp-dir clone: Cookies copied; Singleton* and Cache **absent** in clone; second sync skipped when unchanged

### 4. Demo / honest-run smoke (1)
- Full `JobRunner` demo across 6 sites → `applied: 0`, no `isRealApplied`
- Packaged-style run without Chrome + `allowDemo:false` → phase `error`, `CHROME_PROFILE_REQUIRED`, Hebrew log

### 5. `demo:run` script
- CV analyzed from seeded PDF
- found: 8, applied: **0**, skipped: 8
- Exit gate: fails if `applied !== 0`

### 6. Packaging sanity (no full rebuild this pass)
- Scripts present: `dist:mac:arm64`, `scripts/split-mac-for-media.mjs`, Join `.command` + osascript applet
- Existing media parts still in store (`part00`–`part02`)

---

## מה נכשל / Failures

**None in automated suite.** No fixes required this pass.

---

## מה לא ניתן לבדוק ב-Linux CI / Not verified in cloud

| Area | Why | Manual check for Matan |
|------|-----|------------------------|
| Real LinkedIn Easy Apply | Needs Matan’s logged-in Chrome profile + live site UI | Settings → set path → probe → run with LinkedIn on; expect `applied` only after on-screen confirmation |
| Indeed live apply | Same | Same for Indeed |
| Live SingletonLock with Google Chrome.app | Cloud has no Matan Chrome; we unit-tested clone skip + error strings only | Leave Chrome open after first clone sync; if «פתיחה בסשן קיים», Cmd+Q once → «רענון עותק פרופיל» |
| Join-Jobbot-Mac.app Gatekeeper / Translocation | macOS-only | Re-join parts on Mac; right-click Open if blocked |
| Built-in email delivery | No `JOBBOT_MAIL_API_KEY` in CI | Report still lands in outbox / in-app preview |
| Electron UI clicks | Not re-run this pass | Open app → Settings → probe button → Run tab |

---

## סיכונים שנותרו למתן ב-Mac / Residual risks

1. **Chrome lock:** First profile sync may still need **Cmd+Q** if cookie files are locked; after successful clone, normal Chrome can stay open.
2. **Join friction:** Unsigned app / missing execute bit — use Join.app / Terminal one-liner from `JOBBOT-MAC-README.md`.
3. **Real LinkedIn:** Selectors / Easy Apply / captcha / “already applied” can skip or fail honestly (`skipped` / `unknown` / `failed`) — never fake `applied`.
4. **Career portals (Elbit/IAI):** Live best-effort; bot/login walls → honest Hebrew `not_implemented` (never fake `applied`).
5. **Mail:** Outbox-only until opaque app mail credentials are configured server-side.

---

## Commands used

```bash
cd /workspace/jobbot
npm test          # 11 pass / 0 fail
npm run typecheck # pass
npm run demo:run  # applied=0 OK
```

## Files added this verification

- `core/browser/profile-clone.test.ts`
- `core/runner/demo-smoke.test.ts`
- Demo exit gate in `scripts/demo-run.ts`
