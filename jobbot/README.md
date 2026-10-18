# Jobbot

אוטומציית חיפוש והגשת משרות מקומית עבור **מתן עמר**.

## למשתמש — התקנה בלחיצה (בלי טרמינל)

1. קבל קובץ מתיקיית `jobbot/release/` אחרי בנייה:
   - **Windows (מומלץ):** `Jobbot-Portable-0.1.0.exe` — לחיצה כפולה
   - **Windows (תיקייה):** `Jobbot-Windows-x64.zip` — חלץ ולחץ על `Jobbot.exe`
   - **Linux:** `Jobbot-0.1.0.AppImage` — סמן כהרצה ולחץ פעמיים
2. פתח את **Jobbot** (קיצור שולחן עבודה / התחל נוצר כשמשתמשים ב-NSIS Setup על מכונת Windows עם Wine)
3. בהגדרות ודא:
   - מייל דוח: `matan4749@gmail.com` (כבר ברירת מחדל)
   - קו״ח: כבר מוטמע
   - Chrome user-data-dir: אחרי שהתחברת לאתרים ב-Chrome

**אין צורך ב-`npm install` לשימוש רגיל.**

---

## אתרים

פעילים: LinkedIn, Indeed, AllJobs, Drushim, אלביט, תע״א.

**לא כלולים:** GotFriends, Easy (easy.co.il).

## מייל מובנה

יעד ברירת מחדל: **matan4749@gmail.com**. בלי הגדרת SMTP מצד המשתמש.

## קורות חיים

מוטמע מ-`/cursor/stores/self/cv/matan-amar-cv.pdf` → `assets/cv/matan-amar-cv.pdf`.

---

## למפתחים — בניית חבילה

```bash
cd jobbot
npm install
npm run dist:win      # Windows portable + Setup → release/
npm run dist:linux    # AppImage → release/
npm run dist:dir      # unpacked dir (בדיקה מקומית)
```

פיתוח (לא למשתמש קצה):

```bash
JOBBOT_DEMO=1 npm run dev
npm run demo:run
```

פירוט: Project store `docs/jobbot-plan.md`.
