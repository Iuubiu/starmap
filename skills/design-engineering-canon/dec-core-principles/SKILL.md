---
name: dec-core-principles
description: Foundational design-engineering principles that govern where complexity lives and how interfaces stay fast and consistent — Tesler's Law, progressive disclosure, progressive enhancement, recognition over recall, optimistic UI, perceived performance, single source of truth, constraints as a feature. Use when deciding system architecture vs UI exposure, reducing user-facing complexity, choosing what to render/reveal, or justifying a constraint-driven system.
tags: [design-engineering, principles, ux, architecture, always-on]
---

# Core Design-Engineering Principles

The load-bearing axioms. Each answers a recurring question: *who absorbs the complexity, what do we show now, and where does truth live.*

- **Conservation of Complexity (Tesler's Law):** Every system has irreducible complexity. The only question is who absorbs it — the user or the engineer. Good design engineering pulls complexity *into* the system so the user never sees it. Default: the engineer eats it.
- **Progressive Disclosure:** Show only what's needed now; reveal advanced options on demand. Defeats Hick's Law without removing capability.
- **Progressive Enhancement / Graceful Degradation:** Build a working baseline (semantic HTML, core flow) that functions everywhere, then layer enhancement for capable clients. Inverse: degrade gracefully when JS / network / features are missing.
- **Recognition over Recall:** Surface options visibly rather than forcing users to remember them. Menus over command memorization.
- **Optimistic UI:** Update the interface immediately on user action, assuming success, then reconcile with the server. Makes latency invisible — plan the rollback path.
- **Perceived Performance > Actual Performance:** Skeleton screens, instant feedback, and staged loading often matter more than raw milliseconds.
- **Single Source of Truth:** State, tokens, and content each live in exactly one canonical place and propagate outward. The data-layer version of the token principle.
- **Constraints as a Feature:** Deliberately limiting options (fixed type scale, spacing grid, color ramp) produces consistency and speed. Freedom is the enemy of systems.

## How to apply

- When a flow feels complex to the user, ask *where can the system absorb this instead* before adding UI.
- Reach for progressive disclosure before deleting capability.
- Treat duplicated state/content/tokens as a bug — collapse to one source.
- Justify every new option against the consistency it costs.
