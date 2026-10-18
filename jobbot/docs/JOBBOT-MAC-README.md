# Jobbot for Mac

**Primary (Apple Silicon M1/M2/M3/M4):**

1. Put these in the same folder:
   - `Jobbot-0.1.0-mac-arm64.zip.part00`
   - `Jobbot-0.1.0-mac-arm64.zip.part01`
   - `Jobbot-0.1.0-mac-arm64.zip.part02`
   - `Join-Jobbot-Mac.command`
2. Double-click **Join-Jobbot-Mac.command** → creates `Jobbot-mac.zip`
3. Double-click **Jobbot-mac.zip** → open **Jobbot.app**
4. If Gatekeeper blocks: Right-click Jobbot.app → **Open** (unsigned Linux-built binary)

**Intel Mac:** use `jobbot/release/Jobbot-0.1.0-mac-x64.zip` from the repo workspace / CI artifact.

**DMG:** not available from this Linux builder (needs macOS for `dmg-license` / notarization).
