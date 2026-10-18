# Jobbot

אוטומציית חיפוש והגשת משרות מקומית עבור **מתן עמר** · **macOS first**.

## למשתמש — Mac (בלי טרמינל)

1. Project store `media/`: חלקי zip + `Join-Jobbot-Mac.command`  
   או קובץ מלא: `jobbot/release/Jobbot-0.1.0-mac-arm64.zip`
2. Join (אם חלקים) → חלץ → **Jobbot.app** → Open
3. Gatekeeper: Right-click → Open (unsigned CI build)

Intel: `Jobbot-0.1.0-mac-x64.zip`. Windows/Linux משניים — ראו `docs/INSTALL.md`.

## Defaults

- Email: `matan4749@gmail.com`
- CV: bundled
- Sites: LinkedIn, Indeed, AllJobs, Drushim, Elbit, IAI (לא GotFriends/Easy)

## Developers

```bash
cd jobbot && npm install
npm run dist:mac          # primary
JOBBOT_DEMO=1 npm run dev # optional
```
