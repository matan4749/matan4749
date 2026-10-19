# Jobbot ל-Mac

# ⚠️ אסור ללחוץ פעמיים על Jobbot-mac.zip / Jobbot-mac.tar.gz
# אל תפתח ארכיון ב-Finder / Archive Utility (Error 94)
# רק Join או הפקודה למטה → מקבלים ישר Jobbot.app

---

## Join (חובה להוריד מחדש!)

ה־Join הישן חיפש `.zip.part` — **הורד שוב** `Join-Jobbot-Mac.app.zip`.
הגרסה החדשה מחפשת קודם:
`Jobbot-0.1.0-mac-arm64.tar.gz.part00|01|02`
ואז מחלצת `Jobbot.app` אוטומטית.

Terminal אם Join נכשל:
```bash
cd ~/Desktop/Jobbot
cat Jobbot-0.1.0-mac-arm64.tar.gz.part00 Jobbot-0.1.0-mac-arm64.tar.gz.part01 Jobbot-0.1.0-mac-arm64.tar.gz.part02 > Jobbot-mac.tar.gz
tar -tzf Jobbot-mac.tar.gz && tar -xzf Jobbot-mac.tar.gz && open -R Jobbot.app
```


## מה להוריד (ביילד tar.gz — לא zip!)

1. `Jobbot-0.1.0-mac-arm64.tar.gz.part00`
2. `Jobbot-0.1.0-mac-arm64.tar.gz.part01`
3. `Jobbot-0.1.0-mac-arm64.tar.gz.part02`
4. `Join-Jobbot-Mac.app.zip` (או `.command`)

**מחק** קבצי `.zip.part` / `Jobbot-mac.zip` ישנים.

## איך להתקין

1. שלושת ה-`.tar.gz.part` + Join בתיקייה אחת.
2. לחיצה ימנית על Join ← **פתח** → Jobbot.app.
3. לחיצה ימנית על `Jobbot.app` ← פתח.

## צ׳אט
טאב «צ׳אט» — תכנון ריצה בעברית. בלי מפתח LLM: כללים מקומיים. עם `JOBBOT_LLM_API_KEY` / שדה בהגדרות: API (OpenAI-compatible). לא Cursor Composer בענן.

## Terminal
```bash
mkdir -p ~/Desktop/Jobbot && cd ~/Desktop/Jobbot
rm -f Jobbot-mac.tar.gz Jobbot-mac.zip
cat Jobbot-0.1.0-mac-arm64.tar.gz.part00 Jobbot-0.1.0-mac-arm64.tar.gz.part01 Jobbot-0.1.0-mac-arm64.tar.gz.part02 > Jobbot-mac.tar.gz
shasum -a 256 Jobbot-mac.tar.gz
# חייב: 88a98f4499d3ea6c620d4c9809f852b5edf6c179d297697c8696457c6c0786db
tar -tzf Jobbot-mac.tar.gz && tar -xzf Jobbot-mac.tar.gz
```

## SHA256
| קובץ | SHA256 |
|------|--------|
| Jobbot-mac.tar.gz | `88a98f4499d3ea6c620d4c9809f852b5edf6c179d297697c8696457c6c0786db` |
| part00 | `ae1addc2150bad2ccda429d3153a625edb898d86224cf8c0c6575aa9868fafde` |
| part01 | `11a19ef4bd390362cd7516140bbaf5496f6d18731d6d9e34d53a4928f84c429a` |
| part02 | `d86b56db68b2611eab2d0c0d09e141257d005a1152eff9effcccf2a3aa50582d` |
