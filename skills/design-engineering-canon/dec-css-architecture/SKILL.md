---
name: dec-css-architecture
description: CSS and styling architecture — scaling methodologies (BEM, ITCSS, CUBE CSS) and fluid/responsive technique (mobile-first, clamp() fluid type/space, container queries for component-level responsiveness). Use when structuring stylesheets at scale, choosing a CSS methodology, building responsive layouts, or deciding between media queries and container queries.
tags: [css, styling, responsive, container-queries, architecture, always-on]
---

# CSS / Styling Architecture

How to keep styles scalable and responsive without a utility-first system doing it for you.

- **Methodologies:** **BEM** (block__element--modifier naming), **ITCSS** (inverted-triangle layering by specificity/reach), and **CUBE CSS** (Composition, Utility, Block, Exception) for scaling stylesheets when *not* on a utility-first framework.
- **Fluid & Responsive:**
  - **Mobile-first** — start from the smallest viewport, layer up.
  - **`clamp()`** — fluid type and space that scale between a min and max without breakpoints.
  - **Container queries** — component-level responsiveness based on the *container's* size, not the viewport. The component adapts wherever it's placed.

## How to apply

- On a custom (non-utility) codebase, pick one methodology and hold the line — consistency beats the "best" choice.
- Reach for **container queries** when a component must adapt to its slot (sidebar vs main), not the whole screen — media queries can't express that.
- Use `clamp()` for type and spacing scales to cut breakpoint count and avoid stepwise jumps.
- Start mobile-first; treat larger screens as progressive enhancement.
