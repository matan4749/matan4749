# Jobbot ל-Mac

# ⚠️ אסור ללחוץ פעמיים על Jobbot-mac.zip / Jobbot-mac.tar.gz
# אל תפתח ארכיון ב-Finder / Archive Utility (Error 94)
# רק Join או הפקודה למטה → מקבלים ישר Jobbot.app

---

## מה להוריד (ביילד tar.gz — לא zip!)

1. `Jobbot-0.1.0-mac-arm64.tar.gz.part00`
2. `Jobbot-0.1.0-mac-arm64.tar.gz.part01`
3. `Jobbot-0.1.0-mac-arm64.tar.gz.part02`
4. `Join-Jobbot-Mac.app.zip` (או `.command`)

**מחק** קבצי `.zip.part` / `Jobbot-mac.zip` ישנים.

## איך להתקין (הדרך היחידה)

1. שים את שלושת ה-`.tar.gz.part` + Join בתיקייה אחת (`Desktop/Jobbot`).
2. לחיצה ימנית על Join ← **פתח**.
3. Join מחבר + מחלץ אוטומטית → **Jobbot.app** מופיע.
4. לחיצה ימנית על `Jobbot.app` ← פתח.

## Terminal (אם בלי Join)

```bash
mkdir -p ~/Desktop/Jobbot && cd ~/Desktop/Jobbot
rm -f Jobbot-mac.tar.gz Jobbot-mac.zip
cat Jobbot-0.1.0-mac-arm64.tar.gz.part00 Jobbot-0.1.0-mac-arm64.tar.gz.part01 Jobbot-0.1.0-mac-arm64.tar.gz.part02 > Jobbot-mac.tar.gz
shasum -a 256 Jobbot-mac.tar.gz
# חייב: 2258a77d1f0be5871796a6776830b2509b77b0f13e0f6bf5e87329324ba4cf0d
tar -tzf Jobbot-mac.tar.gz && tar -xzf Jobbot-mac.tar.gz
# עכשיו יש Jobbot.app — לא לפתוח את ה-.tar.gz בלחיצה כפולה
```

## SHA256

| קובץ | SHA256 |
|------|--------|
| Jobbot-mac.tar.gz | `2258a77d1f0be5871796a6776830b2509b77b0f13e0f6bf5e87329324ba4cf0d` |
| part00 | `845235abceba53fbfa4e6defdc2793d5f4cf4943acca448491a1452a0d54ad45` |
| part01 | `07821e79c174065cb727a6dfc5711b60b510b6791b8a4d2042ed7ee5edad3ef2` |
| part02 | `52fd70e2726a29d688b74b78d266ce7c1e903e27b26ac752e3e0847621b40fae` |

קובץ מלא: `SHA256SUMS.txt`

## למה לא zip?

Archive Utility ב-Mac נכשל על zip של Electron (Error 94) גם כש-`unzip -t` עובר.
לכן העברנו ל-`.tar.gz` + Join שמחלץ לבד.

## צ׳אט
טאב «צ׳אט» באפליקציה — תכנון ריצה בעברית. בלי מפתח LLM עובד בכללים מקומיים; עם `JOBBOT_LLM_API_KEY` משתמש ב-API.
