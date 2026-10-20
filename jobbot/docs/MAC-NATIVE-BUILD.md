# Jobbot על Mac — בניה מקומית (חובה אם ה־.app לא נפתח)

## האמת על הבנייה מ־Linux

ה־`Jobbot.app` שארוזנו בענן נבנה ב־**Linux** עם `electron-builder --mac --arm64`:

| מה תקין | מה חסר |
|--------|--------|
| בינארי Mach-O **arm64** רשמי של Electron | **Code signing / notarization** (אפשרי רק ב-Mac) |
| `Info.plist`, `app.asar`, symlinks ב־Frameworks | חתימת Developer ID / ad-hoc על מכונת Mac |

macOS (במיוחד Apple Silicon) לעיתים מציג **«לא ניתן לפתוח … עקב בעיה»** על אפליקציה לא־חתומה שנארזה מחוץ ל-Mac — גם כשהארכיטקטורה נכונה.  
**מסקנה:** אין להסתמך על Linux-cross-build כהפצה יציבה למתן. צריך **בנייה על Mac** (או worker עצמי של Cursor על Mac).

## אפשרות A — הרצה ממקור (הכי מהיר)

1. התקן [Node.js LTS](https://nodejs.org)
2. הורד/שכפל את הריפו, כנס ל־`jobbot/`
3. הרץ:

```bash
chmod +x packaging/Run-Jobbot-On-Mac.command
./packaging/Run-Jobbot-On-Mac.command
```

או:

```bash
npm install && npm run build && npx electron .
```

## אפשרות B — בניית .app מקומית + חתימה ad-hoc

```bash
chmod +x scripts/build-mac-native.sh
./scripts/build-mac-native.sh
# → release/mac-arm64/Jobbot.app (codesign -)
open release/mac-arm64/Jobbot.app
```

## Worker Mac ל־Cloud Agent

כדי שהסוכן יבנה `.app` תקין בענן צריך:

- Cursor **self-hosted worker** על Mac (Apple Silicon)
- Xcode Command Line Tools (`xcode-select --install`)
- Node 20+
- (אופציונלי) Developer ID Application certificate ל־notarization

אין worker Mac מחובר כרגע לסביבה הזו.
