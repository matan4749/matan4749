from __future__ import annotations

import re

# Canonical skill id -> regex that must appear as a whole term.
# Short ambiguous tokens (go, c, ts) are intentionally absent.
_SKILL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("machine learning", re.compile(r"(?<![A-Za-z0-9])machine\s+learning(?![A-Za-z0-9])", re.I)),
    ("deep learning", re.compile(r"(?<![A-Za-z0-9])deep\s+learning(?![A-Za-z0-9])", re.I)),
    ("react native", re.compile(r"(?<![A-Za-z0-9])react\s+native(?![A-Za-z0-9])", re.I)),
    ("nextjs", re.compile(r"(?<![A-Za-z0-9])next\.?js(?![A-Za-z0-9])", re.I)),
    ("nodejs", re.compile(r"(?<![A-Za-z0-9])node\.?js(?![A-Za-z0-9])", re.I)),
    ("react", re.compile(r"(?<![A-Za-z0-9])react(?:\.js)?(?![A-Za-z0-9])", re.I)),
    ("typescript", re.compile(r"(?<![A-Za-z0-9])typescript(?![A-Za-z0-9])", re.I)),
    # "." is excluded so the "js" in Next.js / Node.js / React.js is not JavaScript.
    ("javascript", re.compile(r"(?<![A-Za-z0-9.])javascript(?![A-Za-z0-9])|(?<![A-Za-z0-9.])js(?![A-Za-z0-9])", re.I)),
    ("python", re.compile(r"(?<![A-Za-z0-9])python(?![A-Za-z0-9])", re.I)),
    ("java", re.compile(r"(?<![A-Za-z0-9])java(?![A-Za-z0-9])", re.I)),
    ("kotlin", re.compile(r"(?<![A-Za-z0-9])kotlin(?![A-Za-z0-9])", re.I)),
    ("swift", re.compile(r"(?<![A-Za-z0-9])swift(?![A-Za-z0-9])", re.I)),
    ("vue", re.compile(r"(?<![A-Za-z0-9])vue(?:\.js)?(?![A-Za-z0-9])", re.I)),
    ("angular", re.compile(r"(?<![A-Za-z0-9])angular(?:js)?(?![A-Za-z0-9])", re.I)),
    ("html", re.compile(r"(?<![A-Za-z0-9])html5?(?![A-Za-z0-9])", re.I)),
    ("css", re.compile(r"(?<![A-Za-z0-9])css3?(?![A-Za-z0-9])", re.I)),
    ("tailwind", re.compile(r"(?<![A-Za-z0-9])tailwind(?:\s*css)?(?![A-Za-z0-9])", re.I)),
    ("firebase", re.compile(r"(?<![A-Za-z0-9])firebase(?![A-Za-z0-9])", re.I)),
    ("stripe", re.compile(r"(?<![A-Za-z0-9])stripe(?![A-Za-z0-9])", re.I)),
    ("postgresql", re.compile(r"(?<![A-Za-z0-9])postgres(?:ql)?(?![A-Za-z0-9])", re.I)),
    ("mysql", re.compile(r"(?<![A-Za-z0-9])mysql(?![A-Za-z0-9])", re.I)),
    ("mongodb", re.compile(r"(?<![A-Za-z0-9])mongo(?:db)?(?![A-Za-z0-9])", re.I)),
    ("redis", re.compile(r"(?<![A-Za-z0-9])redis(?![A-Za-z0-9])", re.I)),
    ("docker", re.compile(r"(?<![A-Za-z0-9])docker(?![A-Za-z0-9])", re.I)),
    ("kubernetes", re.compile(r"(?<![A-Za-z0-9])(?:kubernetes|k8s)(?![A-Za-z0-9])", re.I)),
    ("aws", re.compile(r"(?<![A-Za-z0-9])aws(?![A-Za-z0-9])", re.I)),
    ("gcp", re.compile(r"(?<![A-Za-z0-9])gcp(?![A-Za-z0-9])", re.I)),
    ("azure", re.compile(r"(?<![A-Za-z0-9])azure(?![A-Za-z0-9])", re.I)),
    ("git", re.compile(r"(?<![A-Za-z0-9])git(?![A-Za-z0-9])", re.I)),
    ("django", re.compile(r"(?<![A-Za-z0-9])django(?![A-Za-z0-9])", re.I)),
    ("flask", re.compile(r"(?<![A-Za-z0-9])flask(?![A-Za-z0-9])", re.I)),
    ("fastapi", re.compile(r"(?<![A-Za-z0-9])fastapi(?![A-Za-z0-9])", re.I)),
    ("graphql", re.compile(r"(?<![A-Za-z0-9])graphql(?![A-Za-z0-9])", re.I)),
    ("rest", re.compile(r"(?<![A-Za-z0-9])rest(?:\s*apis?)?(?![A-Za-z0-9])", re.I)),
    ("golang", re.compile(r"(?<![A-Za-z0-9])golang(?![A-Za-z0-9])", re.I)),
    ("rust", re.compile(r"(?<![A-Za-z0-9])rust(?![A-Za-z0-9])", re.I)),
    ("php", re.compile(r"(?<![A-Za-z0-9])php(?![A-Za-z0-9])", re.I)),
    ("ruby", re.compile(r"(?<![A-Za-z0-9])ruby(?:\s+on\s+rails)?(?![A-Za-z0-9])", re.I)),
    ("sql", re.compile(r"(?<![A-Za-z0-9])sql(?![A-Za-z0-9])", re.I)),
    ("linux", re.compile(r"(?<![A-Za-z0-9])linux(?![A-Za-z0-9])", re.I)),
    ("terraform", re.compile(r"(?<![A-Za-z0-9])terraform(?![A-Za-z0-9])", re.I)),
    ("pandas", re.compile(r"(?<![A-Za-z0-9])pandas(?![A-Za-z0-9])", re.I)),
    ("tensorflow", re.compile(r"(?<![A-Za-z0-9])tensorflow(?![A-Za-z0-9])", re.I)),
    ("pytorch", re.compile(r"(?<![A-Za-z0-9])pytorch(?![A-Za-z0-9])", re.I)),
    ("spark", re.compile(r"(?<![A-Za-z0-9])spark(?![A-Za-z0-9])", re.I)),
    ("figma", re.compile(r"(?<![A-Za-z0-9])figma(?![A-Za-z0-9])", re.I)),
    ("c++", re.compile(r"(?<![A-Za-z0-9])c\+\+(?![A-Za-z0-9])", re.I)),
    ("csharp", re.compile(r"(?<![A-Za-z0-9])c#|csharp(?![A-Za-z0-9])", re.I)),
]


def known_skills_in(text: str) -> list[str]:
    if not text:
        return []
    found: list[str] = []
    seen: set[str] = set()
    for name, pattern in _SKILL_PATTERNS:
        if name in seen:
            continue
        if pattern.search(text):
            # "java" must not match inside "javascript"
            if name == "java" and re.search(r"javascript", text, re.I) and not re.search(
                r"(?<![A-Za-z])java(?!script)(?![A-Za-z])", text, re.I
            ):
                continue
            seen.add(name)
            found.append(name)
    return found
