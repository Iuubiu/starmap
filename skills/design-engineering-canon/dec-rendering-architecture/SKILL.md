---
name: dec-rendering-architecture
description: Frontend rendering and state architecture — CSR/SSR/SSG/ISR/streaming SSR/RSC chosen per route, state colocation and derived state, server-state vs client-state, Suspense and Error Boundaries as first-class. Use when choosing a rendering strategy, structuring component state, deciding what's server vs client, or designing loading/failure states.
tags: [rendering, architecture, react, state, ssr, always-on]
---

# Rendering & Architecture

Where work happens (server vs client) and where state lives are the two highest-leverage frontend decisions.

- **Rendering Strategies:** CSR, SSR, SSG, ISR, streaming SSR, and React Server Components — chosen **per route** by data freshness and interactivity needs. Static content → SSG/ISR; personalized/fresh → SSR/streaming; highly interactive → client islands.
- **State Colocation & Derived State:** Keep state as close to where it's used as possible; **derive** rather than duplicate. **Server state** (cache of remote data) vs **client state** (UI) are different problems with different tools — don't conflate them.
- **Suspense & Error Boundaries:** Declarative loading and failure states as first-class architecture, not afterthoughts bolted on later.

## How to apply

- Decide rendering route-by-route, not app-wide — match the strategy to each route's freshness/interactivity.
- Lift state only as high as it's actually shared; duplicated state is a bug — derive it.
- Use a server-cache library for remote data; reserve local state for genuine UI concerns.
- Wrap async boundaries in **Suspense** + **Error Boundary** so loading and failure are designed, not accidental.
