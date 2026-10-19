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

### 2) Join-Jobbot-Mac.command
1. הורד `Join-Jobbot-Mac.command.zip` → חלץ
2. שים ליד שלושת ה-`.tar.gz.part`
3. **לחיצה ימנית** ← **פתח**

---

## איך רצים (חשוב!)

1. לחץ **התחל ריצה**
2. נפתח Chrome של Jobbot — **התחבר ידנית** ללינקדאין / אינדיד וכו׳
3. באפליקציה לחץ **«המשך לריצה»**
4. ההתחברות נשמרת — בפעם הבאה לרוב לא צריך שוב
5. אפשר להשאיר את Chrome הרגיל שלך פתוח

מצב «Chrome מערכת» בהגדרות הוא מתקדם בלבד (Cmd+Q + נתיב `…/Google/Chrome`).

## קבצים להורדה
- `Jobbot-0.1.0-mac-arm64.tar.gz.part00` … `part02`
- `Join-Jobbot-Mac.command.zip`
- `SHA256SUMS.txt`
