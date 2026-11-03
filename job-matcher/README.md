# התאמת משרות / Job Matcher

אפליקציית **דסקטופ מקומית** למק. מזינים כתובת של לוח משרות וקובץ קורות חיים (PDF, DOCX או TXT). התוכנית קוראת את ה-HTML הציבורי, מחלצת משרות ודרישות שמופיעות בפועל, ומשווה אותן לקורות החיים — עם דגש על שנות ניסיון. בסוף נשמר דוח Markdown ודוח HTML במחשב, והתוצאות מוצגות בחלון לפי אחוז התאמה.

This is a **local Mac desktop app**, not a website. Give it a job-board URL and a CV (PDF, DOCX, or TXT). It reads the public HTML, extracts only the postings and requirements that are actually there, and scores them against the CV with extra weight on stated years of experience. Results show in the window, sorted by match percent, and are saved as local Markdown and HTML files.

סף ברירת המחדל הוא 50%. אפשר לשנות אותו בחלון או בדגל `--threshold`.

The default minimum match is 50%. Change it in the window or with `--threshold`.

## הרצה על מק / Run on a Mac

צריך Python 3.11 ומעלה **עם Tk** (חלון). ההתקנה מ-[python.org/downloads/macos](https://www.python.org/downloads/macos/) כוללת את Tk.

You need Python 3.11 or newer **with Tk**. The installer from [python.org/downloads/macos](https://www.python.org/downloads/macos/) includes it.

1. פתחו את התיקייה `job-matcher`.
2. לחצו פעמיים על `run-job-matcher.command`.
   אם macOS חוסם את הקובץ: קליק ימני → Open, או בטרמינל:

```bash
cd job-matcher
chmod +x run-job-matcher.command
./run-job-matcher.command
```

ההפעלה הראשונה יוצרת `.venv` ומתקינה את החבילות מ-`requirements.txt`, ואז נפתח החלון. החלון נפתח בגודל המסך כך ששדה הכתובת, קורות החיים, הסף וכפתור ההרצה נשארים למעלה.

First launch creates `.venv`, installs dependencies, and opens the window. The window is sized to the screen so the URL field, CV picker, threshold, and run button stay at the top.

Python של macOS (LibreSSL) מדפיס אזהרה עם urllib3 2. הקובץ `requirements.txt` נועל את urllib3 לגרסה 1.26, בלי האזהרה.

macOS system Python (LibreSSL) warns if urllib3 2 is installed. `requirements.txt` pins urllib3 1.26 so that warning is not printed.

### בלי הקובץ .command / Without the launcher

```bash
cd job-matcher
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 -m job_matcher
```

אם חסר Tkinter:

```bash
brew install python-tk
```

ואז פתחו מחדש את אותו Python.

### בדיקה בלי חלון / Report without the window

על עותק שמור של עמוד, או על קבצי הדוגמה שבתיקייה:

```bash
cd job-matcher
source .venv/bin/activate
python3 -m job_matcher --html fixtures/board.html --cv fixtures/sample_cv.txt --out reports --threshold 50
```

או מול אתר אמיתי:

```bash
python3 -m job_matcher --url "https://example.com/careers" --cv ~/Desktop/cv.pdf --out ~/Documents/job-matcher-reports
```

נשמרים שני קבצים: `job-match-YYYYMMDD-HHMMSS.md` ו-`.html`. את ה-HTML פותחים בדפדפן במק (Safari או Chrome) — זה קובץ מקומי, לא שרת.

## מה יש בדוח / What the report contains

לכל משרה שמגיעה לסף:

- אחוז התאמה וסיבה קצרה
- קישור למשרה
- כותרת, חברה, מיקום ותיאור כפי שחולצו
- כל דרישה שחולצה, עם סימון נענה / חלקי / חסר מול קורות החיים

משרות מתחת לסף מופיעות בקצרה. אם העמוד נחסם, דורש התחברות, או נטען רק ב-JavaScript — הדוח אומר את זה, ולא ממציא משרות.

## מגבלות / Limits

- אין דפדפן ואין עקיפת התחברות. אתר שדורש חשבון, חומת captcha, או חוסם בקשות (למשל Cloudflare) ייכשל בצורה מפורשת.
- אתרים שהמשרות שלהם נבנות רק ב-JavaScript (הרבה עמודי LinkedIn, Indeed, וחלק מ-Workday) לא יחזירו משרות. האפליקציה קוראת HTML ציבורי, כולל JSON-LD מסוג `JobPosting`, ומזהה מבני לוחות נפוצים כשהתוכן נמצא ב-HTML (Greenhouse, Lever, עמוד עם כותרות Requirements / דרישות).
- PDF סרוק בלי שכבת טקסט לא נקרא.
- האחוז הוא כלל שקוף על הטקסט שחולץ, לא שיפוט של מגייס. דרישת ניסיון עם מספר שנים שוקלת יותר. אם שנות הניסיון בתחום לא כתובות בקורות החיים, הדרישה לא תסומן כנענתה במלואה.
- נקראים עד 3 עמודי רשימה ועד 30 משרות בכל הרצה.
