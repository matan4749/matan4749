# Jobbot — תוכנית מוצר (מעודכן)

## ברירת מחדל: פרופיל Jobbot + שער התחברות

1. **פרופיל קבוע** תחת `jobbot-data/browser-profile/` — לא נמחק בין ריצות.
2. **בתחילת כל ריצה:** נפתח Chrome עם הפרופיל הזה → מתן מתחבר ידנית לאתרים (LinkedIn, Indeed, …).
3. **UI:** מודאל «התחבר לאתרים בחלון Chrome שנפתח. כשסיימת — לחץ המשך» עם **המשך לריצה** / **ביטול**.
4. אחרי «המשך» — חיפוש והגשה ב**אותו** חלון Chrome (אותו context).
5. Chrome הרגיל של המערכת יכול להישאר פתוח.

## לא ברירת מחדל

- העתקת Cookies מ־`~/Library/.../Google/Chrome` (שביר / EPERM / פרופיל ריק).
- `launchPersistentContext` על פרופיל המערכת (timeout / SingletonLock).

## מצב מתקדם (הגדרות)

- **Chrome מערכת** — נתיב `…/Google/Chrome`, חובה Cmd+Q.
- אופציונלי: עותק clone.

## טכני

- הפעלה: spawn Chrome + `connectOverCDP` (ללא `--no-sandbox` / ללא mock-keychain).
- `sharedBrowser` ב־`SiteAdapterContext` — adapters לא סוגרים את הדפדפן.
