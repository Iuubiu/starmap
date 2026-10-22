---
name: dec-motion-animation
description: Interface motion and animation — the 12 principles of animation applied to UI, easing and spring physics (ease-out entrances / ease-in exits), the FLIP technique for performant layout animation, and motion as feedback not decoration. Use when animating a transition, choosing easing/duration, building layout animations, or deciding whether motion is communicating or just decorating.
tags: [motion, animation, easing, flip, ux, always-on]
---

# Motion & Animation

Motion should communicate state and spatial relationships — never decorate.

- **12 Principles of Animation (Disney → UI):** Especially **easing, anticipation, follow-through, and staging** applied to interface transitions. Motion should feel physical and intentional.
- **Easing & Spring Physics:** Natural motion uses **ease-out for entrances** (decelerate in) and **ease-in for exits** (accelerate out). **Spring-based** motion (stiffness/damping) reads more physical than fixed-duration curves.
- **FLIP Technique:** **F**irst, **L**ast, **I**nvert, **P**lay — performant layout animations by measuring start/end and animating **transforms**, not layout-triggering properties (width/height/top/left).
- **Motion as Feedback:** Animation should communicate state change and spatial relationships, never decorate. If it doesn't clarify, cut it.

## How to apply

- Entrances ease-out, exits ease-in; asymmetric durations read more natural than symmetric.
- Animate only `transform` and `opacity` to stay on the compositor and hold 60fps — use **FLIP** for layout moves.
- Prefer springs for interactive, gesture-driven motion; fixed curves for deterministic state transitions.
- Respect `prefers-reduced-motion` — provide a reduced/instant fallback for every non-essential animation.
- Before adding motion, ask what it *communicates*. No answer → don't animate.
