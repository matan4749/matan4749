# Jobbot Learning Loop

After every run, Jobbot persists failures and adjusts site-adapter heuristics for the next run.

## Storage

- Path: `{userData}/jobbot-data/knowledge/failures.json`
- Schema version: `1` (JSON; SQLite-ready later)

```json
{
  "version": 1,
  "updatedAt": "ISO-8601",
  "sites": {
    "linkedin": {
      "adapterVersion": "1.0.2",
      "preferredSelectors": { "easyApply": ["button.jobs-apply-button"] },
      "skipSteps": ["easyApplyClick"],
      "recentFailures": [],
      "recentSuccesses": []
    }
  },
  "failures": []
}
```

## Flow

1. **Capture** — each `failed` `ApplyResult` becomes a `FailureRecord` (site, step, selector, error, adapterVersion).
2. **Deprioritize** — same selector failing ≥3 times is removed from `preferredSelectors`.
3. **Skip** — same step failing ≥5 times is added to `skipSteps` (adapter may refuse that step).
4. **Version bump** — ≥5 recent failures on a site bumps `adapterVersion` patch (signals “needs selector refresh”).
5. **Next run** — adapters call `pickSelector(knowledge, key, fallbacks)` so preferred selectors are tried first.

## Manual tips

- Inspect KB from the app data dir (Settings → or `app:dataDir` IPC).
- After LinkedIn/Indeed UI changes, clear `skipSteps` or bump adapters once selectors are fixed.
- Demo mode (`JOBBOT_DEMO=1`) still writes learning data so you can exercise the loop offline.
