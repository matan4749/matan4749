# Jobbot — התקנה למשתמש (בלי טרמינל)

## Mac (נתיב ראשי)

מתן על **macOS**.

### Apple Silicon (M1 / M2 / M3 / M4) — מומלץ

קבצים ב-Project store `media/`:

1. הורד לאותה תיקייה:
   - `Jobbot-0.1.0-mac-arm64.zip.part00` … `part02`
   - `Join-Jobbot-Mac.command`
2. לחיצה כפולה על **`Join-Jobbot-Mac.command`** → נוצר `Jobbot-mac.zip`
3. לחיצה כפולה על ה-zip → פתח **`Jobbot.app`**
4. אם macOS חוסם (בנייה לא חתומה מ-Linux): **לחיצה ימנית על Jobbot.app → Open**

קובץ מלא גם ב-workspace: `jobbot/release/Jobbot-0.1.0-mac-arm64.zip`

### Intel Mac

`jobbot/release/Jobbot-0.1.0-mac-x64.zip` → חלץ → `Jobbot.app`

### DMG / חתימה

`.dmg` וחתימה/נוטריזציה דורשים בנייה על **Mac** עם Apple Developer ID. ה-Linux CI כאן מייצר `.app` בתוך zip (לא חתום).

---

## Windows (משני / אופציונלי)

`Jobbot-Portable-0.1.0.exe` או zip — רק אם צריך Windows.

## Linux (אופציונלי)

`Jobbot-0.1.0.AppImage`

---

## אחרי הפתיחה

- מייל דוח: `matan4749@gmail.com`
- קו״ח מוטמע
- הגדר Chrome user-data-dir אחרי login לאתרים

**לא כלולים:** GotFriends, Easy.
