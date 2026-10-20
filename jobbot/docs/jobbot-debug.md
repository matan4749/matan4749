# Jobbot — דיבאג / לוגים

ייצוא קל (בלי פרופיל דפדפן): הורד `העתק-לוגים.app.zip` מ־media → שלח `~/Desktop/Jobbot-logs-*.zip`.

One-liner:

```bash
D="$HOME/Library/Application Support/jobbot/jobbot-data"; Z="$HOME/Desktop/Jobbot-logs-tiny-$(date +%Y%m%d-%H%M%S).zip"; mkdir -p /tmp/jb-tiny/runs && cp -f "$D/settings.json" "$D/chat.json" "$D/runs/latest.json" /tmp/jb-tiny/ 2>/dev/null; cp -f "$D/runs"/run-*.json /tmp/jb-tiny/runs/ 2>/dev/null; tail -n 200 "$HOME/Library/Logs/Jobbot-launcher.log" > /tmp/jb-tiny/launcher.tail.log 2>/dev/null; ditto -c -k --sequesterRsrc /tmp/jb-tiny "$Z"; open -R "$Z"; echo "$Z"
```

פירוט מלא: Project store `docs/jobbot-debug.md`.
