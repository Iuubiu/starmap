---
name: dec-quality-testing
description: Frontend quality and testing strategy — visual regression testing (snapshot diffing) and the Testing Trophy (favor integration tests over the classic pyramid for UI). Use when deciding what kind of tests to write for UI, setting up snapshot/visual diffing, or arguing test strategy for a component or app.
tags: [testing, quality, visual-regression, testing-trophy, always-on]
---

# Quality & Testing

How to test UI so the tests reflect what users actually experience.

- **Visual Regression Testing:** Snapshot diffing (Chromatic, Percy, Playwright snapshots) to catch unintended UI changes. Pixels are the source of truth for appearance — assert on them.
- **Testing Trophy (Kent C. Dodds):** For UI, favor **integration tests** over the classic pyramid. Shape (bottom → top): static (types/lint) → unit → **integration (the bulk)** → e2e. Test **behavior users experience**, not implementation details.

## How to apply

- Default UI tests to the **integration** layer: render the component with its real collaborators, interact like a user, assert on visible outcomes.
- Avoid testing implementation details (internal state, private methods) — they break on refactors that don't change behavior.
- Add **visual regression** snapshots for components where appearance is the contract (design-system primitives, marketing pages).
- Keep e2e few and high-value (critical flows only); lean on static checks (types, lint) as the cheap first line.
