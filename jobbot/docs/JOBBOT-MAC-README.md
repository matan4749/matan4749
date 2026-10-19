# Jobbot ל-Mac — התקנה

## מה ללחוץ (לפי סדר אמינות)

### 1) Terminal — הכי אמין (מומלץ!)
1. שים את שלושת `Jobbot-…tar.gz.part0*` ב-`~/Desktop/Jobbot`
2. פתח **Terminal** והדבק (גם ב-`JOIN-ONE-LINER.txt`):

```bash
mkdir -p ~/Desktop/Jobbot && cd ~/Desktop/Jobbot
cat Jobbot-0.1.0-mac-arm64.tar.gz.part00 Jobbot-0.1.0-mac-arm64.tar.gz.part01 Jobbot-0.1.0-mac-arm64.tar.gz.part02 > Jobbot-mac.tar.gz
tar -tzf Jobbot-mac.tar.gz && tar -xzf Jobbot-mac.tar.gz
xattr -dr com.apple.quarantine Jobbot.app 2>/dev/null
open -R Jobbot.app
```

3. לחיצה ימנית על `Jobbot.app` ← **פתח**

### 2) Join-Jobbot-Mac.command (מומלץ אחרי Terminal)
1. הורד `Join-Jobbot-Mac.command.zip` → חלץ
2. שים ליד שלושת ה-`.tar.gz.part`
3. **לחיצה ימנית** ← **פתח** ← פתח  
   (לא לחיצה כפולה — Gatekeeper עלול לבלוע בשקט)
4. אם צריך: `chmod +x Join-Jobbot-Mac.command` בטרמינל
5. אמור להופיע דיאלוג «מתחיל…» מיד

### 3) Join-Jobbot-Mac.app — רק אם .command לא עובד
- הורד מחדש `Join-Jobbot-Mac.app.zip`
- לחיצה ימנית ← פתח
- חייב דיאלוג «מתחיל…» — אם **שום דבר**, חזור ל-Terminal (#1)

---

# ⚠️ אסור ללחוץ פעמיים על Jobbot-mac.tar.gz / .zip ב-Finder

## קבצים להורדה
- `Jobbot-0.1.0-mac-arm64.tar.gz.part00` … `part02`
- `Join-Jobbot-Mac.command.zip` (עדיף) או `.command`
- `Join-Jobbot-Mac.app.zip` (גיבוי)
- `SHA256SUMS.txt`

## צ׳אט
טאב «צ׳אט» באפליקציה — תכנון ריצה בעברית.

## Chrome — פרופיל חי (ברירת מחדל)
Jobbot פותח את **Chrome שלך** עם הפרופיל המחובר (לא פרופיל ריק).

1. נתיב: `/Users/matan_amar/Library/Application Support/Google/Chrome` (**בלי** `/Default`)
2. סגור Chrome לגמרי עם **Cmd+Q** לפני ריצה
3. **הגדרות מערכת → פרטיות ואבטחה → Full Disk Access** → הפעל **Jobbot** → הפעל מחדש
4. אופציונלי: «השתמש בעותק / אפשר Chrome פתוח» — רק אם רוצים להשאיר Chrome פתוח; אם העותק בלי Cookies / מסך התחברות — Jobbot עוצר

אם מופיע מסך התחברות ריק בלינקדאין או באנר `--no-sandbox` — התקן את הגרסה החדשה (ללא `--no-sandbox` / ללא mock keychain).
