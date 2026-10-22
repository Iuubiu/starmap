---
name: dec-web-performance
description: Web performance as a UX constraint — Core Web Vitals (LCP, INP, CLS) and the RAIL model with perception-keyed budgets. Use when setting performance budgets, diagnosing slow or janky pages, deciding what to optimize, or tying performance work to human-perception thresholds.
tags: [performance, core-web-vitals, rail, ux, always-on]
---

# Performance

Performance is a UX problem with measurable, perception-keyed budgets.

- **Core Web Vitals:**
  - **LCP** (Largest Contentful Paint) — loading; the main content should render fast. Budget: ≤2.5s.
  - **INP** (Interaction to Next Paint) — interactivity; replaced FID in 2024. Budget: ≤200ms.
  - **CLS** (Cumulative Layout Shift) — visual stability; no content jumping. Budget: ≤0.1.
- **RAIL Model:** Performance budgets keyed to human perception:
  - **Response** — react to input in <100ms.
  - **Animation** — 60fps, ~16ms per frame.
  - **Idle** — chunk non-critical work into idle time.
  - **Load** — become interactive fast; defer the rest.

## How to apply

- Set explicit budgets (LCP/INP/CLS, frame time) and measure at the **p75** of real users, not a fast laptop.
- **CLS:** reserve space for images/ads/embeds; never inject content above existing content.
- **INP:** break long tasks, defer non-critical JS, keep the main thread free for input.
- Animate only `transform`/`opacity` to hold 60fps (see FLIP in dec-motion-animation).
