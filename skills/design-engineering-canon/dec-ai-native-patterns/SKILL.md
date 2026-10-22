---
name: dec-ai-native-patterns
description: AI-native design engineering patterns — generative/adaptive UI, streaming as interaction, prompt-as-interface, human-in-the-loop / agentic UX, eval-driven development, designing for uncertainty, latency and cost as design constraints. Use when designing any AI/LLM-powered feature, building agentic or chat UX, handling streaming/probabilistic output, or planning for model error and cost.
tags: [ai-native, llm, agentic-ux, streaming, evals, always-on]
---

# AI-Native Design Engineering

The new layer, increasingly central to the role. Probabilistic systems need UX that plans for being wrong.

- **Generative / Adaptive UI:** Interfaces assembled or personalized at runtime by a model rather than fully predetermined.
- **Streaming as Interaction:** Token-by-token output, partial results, and stop/regenerate controls are core interaction patterns, not edge cases.
- **Prompt-as-Interface:** Natural language as an input modality *alongside* (not replacing) direct manipulation — with affordances that teach users what the system can do.
- **Human-in-the-Loop / Agentic UX:** Design review, approval, correction, and undo around autonomous actions; surface confidence and provenance.
- **Eval-Driven Development:** Treat model behavior as a testable surface — eval sets and regression checks for AI features, analogous to visual regression for UI.
- **Designing for Uncertainty:** Probabilistic outputs need graceful failure, transparent limitations, and easy escape hatches. The system *will* be wrong; the UX plans for it.
- **Latency & Cost as Design Constraints:** Model choice, caching, and streaming are UX decisions, not just infra ones.

## How to apply

- Make **streaming** first-class: show partial output immediately, always offer **stop** and **regenerate**.
- For agentic actions, design the **review/approve/undo** loop *before* the autonomous capability — surface confidence and provenance.
- Teach the user what the system can do via input **affordances**, not a blank prompt box.
- Build an **eval set** early and run it like a regression suite; "looks good once" is not a test.
- Plan the **wrong-answer path** (graceful failure + escape hatch) as carefully as the happy path.
- Treat **latency/cost/model choice** as UX levers — cache, stream, and pick the smallest model that meets the bar.
