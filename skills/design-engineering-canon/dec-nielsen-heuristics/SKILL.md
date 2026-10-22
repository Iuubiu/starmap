---
name: dec-nielsen-heuristics
description: Jakob Nielsen's 10 usability heuristics — the bedrock checklist for evaluating any interface. Use when running a heuristic evaluation, reviewing a screen for usability problems, justifying a UX critique, or sanity-checking that status, error recovery, consistency, and undo are handled.
tags: [usability, heuristics, nielsen, evaluation, ux, always-on]
---

# Nielsen's 10 Usability Heuristics

The canonical evaluation lens. Walk any interface against all ten; each violation is a concrete, fixable defect.

1. **Visibility of system status** — keep users informed with timely feedback.
2. **Match between system and the real world** — speak the user's language, follow real-world conventions.
3. **User control and freedom** — clear undo / redo / escape hatches from mistaken states.
4. **Consistency and standards** — same word/action means the same thing; follow platform conventions.
5. **Error prevention** — design out error conditions before they happen (confirmations, constraints).
6. **Recognition rather than recall** — make options, actions, and objects visible; minimize memory load.
7. **Flexibility and efficiency of use** — accelerators (shortcuts, defaults) for experts, without blocking novices.
8. **Aesthetic and minimalist design** — every extra unit of information competes with the relevant.
9. **Help users recognize, diagnose, and recover from errors** — plain-language messages, precise problem, constructive fix.
10. **Help and documentation** — searchable, task-focused, concrete steps, kept small.

## How to apply

- Use as a scored audit: rate each heuristic 0 (violated) → 4 (fully met) per screen.
- Pair #5 (prevention) and #9 (recovery) — prevent first, recover gracefully second.
- #6 vs recall: if a user must remember something from a prior screen, that's a violation — surface it.
