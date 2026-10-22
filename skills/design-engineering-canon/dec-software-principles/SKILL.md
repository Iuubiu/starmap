---
name: dec-software-principles
description: Core software engineering principles for the engineering half of design engineering — SOLID, DRY/KISS/YAGNI, Conway's Law, Principle of Least Astonishment. Use when structuring code, reviewing architecture, naming/shaping components, resisting over-abstraction, or explaining why a component should behave as its name implies.
tags: [software-principles, solid, architecture, code-quality, always-on]
---

# Software Principles

The engineering half of design engineering — how code stays maintainable.

- **SOLID:**
  - **S**ingle responsibility — one reason to change per unit.
  - **O**pen/closed — open to extension, closed to modification.
  - **L**iskov substitution — subtypes must be usable wherever the base type is.
  - **I**nterface segregation — many small interfaces over one fat one.
  - **D**ependency inversion — depend on abstractions, not concretions.
- **DRY / KISS / YAGNI:** Don't repeat yourself; keep it simple; you aren't gonna need it. YAGNI is the antidote to speculative abstraction — don't generalize until you have concrete uses.
- **Conway's Law:** Systems mirror the communication structure of the org that builds them — team topology *is* an architecture decision.
- **Principle of Least Astonishment:** Components should behave the way their name and appearance imply. Surprise is a defect.

## How to apply

- **YAGNI before DRY:** don't abstract until you have ~3 concrete uses; premature DRY couples unrelated things.
- Single-responsibility is the most useful SOLID letter day-to-day — if a unit needs "and" to describe it, split it.
- Name components for what they do; if behavior surprises a reader of the name, rename or fix the behavior (Least Astonishment).
- When a system's structure feels wrong, check **Conway's Law** — it may mirror a team boundary, not a technical one.
