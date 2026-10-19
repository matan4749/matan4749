# Jobbot ל-Mac — התקנה (חלקים מאומתים)

**חשוב:** מחק קבצי `Jobbot-mac.zip` ו-`.part` ישנים. הורד **שלושת** החלקים מ**אותו ביילד**, ואז חבר.

## SHA256 (ביילד זה)

| קובץ | SHA256 |
|------|--------|
| Jobbot-mac.zip (אחרי cat) | `9d4c6905979e7857085984b660239f87f46d003ff41d5884583e9e388d89e7b3` |
| part00 | `b5309d67ccf9fdd2748123d5de79b44af9bfc6416b01a9414027d6cc45cdb187` |
| part01 | `294f8685d3c9aec6e06c11bb4eca0f199f92bf47175c092d80d3f6ff9a07ff5d` |
| part02 | `ed207740fb11d2b8d5f277f6c78bdc6ef9bd5aa2e153127cfee68d4d49d9f196` |

גם ב-`SHA256SUMS.txt` בתיקיית media.

## חיבור + חילוץ (מומלץ — עוקף Error 94 של Archive Utility)

### Join.app / .command
1. הורד `Join-Jobbot-Mac.app.zip` או `Join-Jobbot-Mac.command`
2. שים ליד שלושת ה-`.part`
3. לחיצה ימנית ← **פתח**
4. Join בודק `unzip -t` ומחלץ `Jobbot.app` (לא דרך Archive Utility)

אם zip פגום: «הורד שוב את שלושת החלקים מאותו ביילד».

### Terminal

```bash
mkdir -p ~/Desktop/Jobbot && cd ~/Desktop/Jobbot
# העבר לכאן את שלושת ה-.part ואז:
rm -f Jobbot-mac.zip
cat Jobbot-0.1.0-mac-arm64.zip.part00 Jobbot-0.1.0-mac-arm64.zip.part01 Jobbot-0.1.0-mac-arm64.zip.part02 > Jobbot-mac.zip
shasum -a 256 Jobbot-mac.zip   # חייב להיות 9d4c6905979e7857085984b660239f87f46d003ff41d5884583e9e388d89e7b3
unzip -t Jobbot-mac.zip && unzip -o Jobbot-mac.zip
```

אם Archive Utility אומר Error 94 / «הודעה לא תקינה» — **אל תשתמש בו**; השתמש ב-`unzip` או ב-Join כנ״ל.

## אחרי החילוץ
לחיצה ימנית על `Jobbot.app` ← פתח. הגדר Chrome + «וודא ש־Chrome סגור».
