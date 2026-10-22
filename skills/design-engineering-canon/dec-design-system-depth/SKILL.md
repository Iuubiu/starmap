---
name: dec-design-system-depth
description: Design system depth beyond "tokens are data" — three-tier token architecture (primitive → semantic → component), W3C DTCG format and tooling, scales as systems, component API design, headless/unstyled primitives, documentation as product, governance and versioning. Use when architecting a design system, structuring tokens, designing component APIs, choosing headless primitives, or setting up contribution/versioning.
tags: [design-systems, tokens, components, governance, headless, always-on]
---

# Design System Depth

A real design system is token architecture + component contracts + governance — not a Figma file of colors.

- **Three-Tier Token Architecture:**
  1. **Primitive / Global** — raw values (`blue-500`, `space-4`).
  2. **Semantic / Alias** — intent-mapped (`color-action-primary`, `space-inset-md`).
  3. **Component-Specific** — scoped (`button-bg-hover`).
  Components only ever consume semantic/component tiers, **never** primitives.
- **W3C DTCG Format & Tooling:** Design Tokens Community Group spec; Style Dictionary and Tokens Studio transform one source into CSS / iOS / Android / JSON.
- **Scales as Systems:** 4pt/8pt spacing grid, modular type scale (e.g. 1.25 ratio), constrained color ramps. Decisions become lookups.
- **Component API Design:** Props as the contract; variants, sizes, and states as enumerable options; **compound components** and **slots** for composition; sensible defaults so the easy thing is the right thing.
- **Headless / Unstyled Primitives:** Radix, React Aria, Ark — accessibility and behavior solved in the primitive, styling left to the system. The modern foundation.
- **Documentation as Product:** Storybook for live docs; usage guidelines, do/don't, props tables treated as part of the deliverable.
- **Governance & Versioning:** Contribution models, semver for breaking changes, deprecation paths, adoption metrics.

## How to apply

- Never let a component reference a **primitive** token directly — route through a semantic alias so theming works.
- Build behavior/accessibility on a **headless primitive**, then layer system styling — don't re-solve focus traps and ARIA per component.
- Treat the component **API as the contract**: enumerable variants/sizes/states, good defaults, composition via slots.
- Ship **docs and a versioning/deprecation policy** with the system, or adoption stalls.
