---
name: dec
description: "Use when the user invokes /dec, says 'run design engineering skills', or starts any design-engineering task — building/reviewing UI, scoping a product, shipping decisions, performance, AI-native UX — and it's unclear which dec-* skills apply. Dispatcher that routes to the right 2-4 of the 20 dec-* canon skills instead of loading the whole family."
---

# Dec — Design Engineering Canon Dispatcher

## Overview

The dec-* canon is 20 named-principle skills. Transcript evidence shows they fire in stable clusters per task type — and that "run design engineering skills" currently triggers an ad-hoc 6-skill load. This router makes the cluster choice deliberate.

**Resolve the target first**: the screen/feature/decision in the argument, else the active work. State it in one line, load the routed skills via the Skill tool, and reason from their named principles while working — router, not recital.

## Routing Table

| Task | Skills (in priority order) |
|---|---|
| Building an interactive UI / component (default row) | dec-accessibility, dec-core-principles, dec-cognitive-load, dec-css-architecture |
| Reviewing / auditing a screen for usability defects | dec-nielsen-heuristics, dec-accessibility, dec-norman-principles |
| "This feels overwhelming / confusing" diagnosis | dec-cognitive-load, dec-gestalt-principles, dec-krug-laws |
| Visual/communication design, taste, restraint | dec-rams-principles, dec-gestalt-principles, dec-motion-animation |
| Motion / transition decisions | dec-motion-animation, dec-core-principles |
| Ship/defer decisions, backlog ranking | dec-prioritization-frameworks, dec-product-metrics, dec-core-principles |
| Defining success / instrumenting a feature | dec-product-metrics, dec-discovery-validation |
| Scoping what to build / validating an idea | dec-discovery-validation, dec-prioritization-frameworks, dec-krug-laws |
| Slow or janky page | dec-web-performance, dec-rendering-architecture, dec-cognitive-load |
| Rendering / state architecture choices | dec-rendering-architecture, dec-software-principles |
| Styling architecture at scale | dec-css-architecture, dec-design-system-depth |
| Design system / tokens / component APIs | dec-design-system-depth, dec-css-architecture, dec-software-principles |
| AI/LLM-powered feature or agentic UX | dec-ai-native-patterns, dec-core-principles, dec-ux-laws |
| Justifying a UX call with a named law | dec-ux-laws, dec-nielsen-heuristics |
| Test strategy for UI | dec-quality-testing, dec-software-principles |
| Full sweep (`/dec full` — rare, major audit only) | dec-core-principles, dec-accessibility, dec-motion-animation, dec-css-architecture, dec-cognitive-load, dec-web-performance, then the rest as the audit demands |

Ambiguous target → the default row.

## Rules

- **Load at most 4 per pass** (full sweep excepted). Multiple rows match → primary row + one load-bearing skill from the secondary row.
- **dec-core-principles is the common denominator** — when in doubt whether to include it, include it.
- **Reviews always pair dec-nielsen-heuristics with dec-accessibility** — observed to travel together; a review with one and not the other misses half the defects.
- **Canon vs specs:** this family carries named principles (why); the /design family carries concrete values (what — tokens, ramps, grids). Deep UI work usually needs one skill from each, not five from one.
- Name which skills you loaded, per the always-on dec-* discipline in CLAUDE.md.
