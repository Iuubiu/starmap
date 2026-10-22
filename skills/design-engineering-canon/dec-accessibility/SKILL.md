---
name: dec-accessibility
description: Accessibility foundations for design engineers — WCAG / POUR, semantic-HTML-first then ARIA, keyboard and focus management, inclusive design for permanent/temporary/situational constraints. Use when building or reviewing any interactive UI, adding ARIA, implementing modals/menus/forms, or auditing keyboard operability and focus order.
tags: [accessibility, a11y, wcag, keyboard, inclusive-design, always-on]
---

# Accessibility

A critical, non-optional layer for a design engineer. Target WCAG **AA**.

- **WCAG / POUR:** Content must be **P**erceivable, **O**perable, **U**nderstandable, **R**obust. AA conformance is the floor.
- **Semantic HTML first, ARIA second:** Native elements carry built-in accessibility; ARIA only patches what HTML can't express. *"No ARIA is better than bad ARIA."*
- **Keyboard & Focus Management:** Full keyboard operability, visible focus rings, logical tab order, focus traps in modals, restored focus on close.
- **Inclusive Design:** Design for permanent, temporary, and situational constraints (one-armed, broken-armed, holding-a-baby). Accessibility is the curb-cut that helps everyone.

## How to apply

- Reach for the native element (`button`, `a`, `label`, `dialog`, `nav`) before any `div` + ARIA combination.
- Every interactive must be reachable and operable by keyboard, with a visible focus state.
- Modals: trap focus inside, return focus to the trigger on close, close on `Esc`.
- Real `<label>` for every input — placeholder is never a label.
- Verify against AA contrast (4.5:1 text / 3:1 large & UI) and test with a screen reader, not just the eye.
