---
name: dec-norman-principles
description: Don Norman's principles of interaction design — affordances & signifiers, mapping, feedback, constraints, conceptual model, and the gulfs of execution and evaluation. Use when an interface is confusing, a control's behavior isn't obvious, you're designing how an object signals what it does, or diagnosing why users can't connect intention to action.
tags: [interaction-design, norman, affordances, mental-models, ux, always-on]
---

# Don Norman — Principles of Interaction

How people understand and operate things. Use to diagnose *why* a control is unintuitive, not just that it is.

- **Affordances & Signifiers:** What an object *can* do (affordance) vs the perceptible cue telling the user it can (signifier). Most "discoverability" bugs are missing signifiers.
- **Mapping:** Spatial / logical correspondence between controls and their effects (stove knobs → burners). Natural mapping removes a learning step.
- **Feedback:** Every action gets a visible, immediate response. Silence reads as failure.
- **Constraints:** Physical, logical, semantic, and cultural limits that prevent error before it happens.
- **Conceptual Model:** The user's mental picture must match how the system actually behaves. Mismatch = confusion that no copy can fully patch.
- **Gulf of Execution / Gulf of Evaluation:** The gap between intention → action, and between system-state → understanding. Design must close both: make actions obvious (execution) and results legible (evaluation).

## How to apply

- Confusing control? Ask which is missing: affordance, signifier, mapping, or feedback.
- Bridge the Gulf of Execution with clear signifiers; bridge the Gulf of Evaluation with clear feedback and status.
- When users hold a wrong mental model, fix the model (structure, naming, behavior) before adding help text.
