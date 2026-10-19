# assistant-ui/apps/docs/content/examples/artifacts.mdx at main · assistant-ui/assistant-ui
https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/examples/artifacts.mdx

Skip to content

\#\# Navigation Menu

\{\{ message \}\}

\#\# Repository navigation

\# artifacts\.mdx

\# artifacts\.mdx

\#\# File metadata and controls

37 lines \(26 loc\) · 1\.71 KB

title \| Claude Artifacts Example 
\-\-\-\|\-\-\-
description \| Open\-source Claude Artifacts implementation in React\. Generate websites and components in a side panel from chat messages\, built on assistant\-ui\. 

\#\# Overview

An open\-source implementation of Claude Artifacts that allows users to generate interactive content like websites\, documents\, and applications directly within the chat interface\. The AI generates HTML\, CSS\, and JavaScript code that renders in a live preview panel alongside the conversation\.

\#\# Features

\- Live Preview\: Generated artifacts render in a sandboxed iframe
\- Code Generation\: Creates complete HTML\, CSS\, and JavaScript applications
\- Interactive Elements\: Artifacts can include buttons\, forms\, and animations
\- Iteration Support\: Ask the AI to modify and improve generated artifacts
\- Safe Execution\: Code runs in a sandboxed iframe with scripts enabled but no access to the parent page

\#\# How It Works

\- Request\: Ask the AI to create something \(e\.g\.\, \"Create a calculator app\"\)
\- Generation\: The AI generates the necessary HTML\, CSS\, and JavaScript
\- Rendering\: Code is safely rendered in an isolated preview panel
\- Iteration\: Request changes and see updates in real\-time

\#\# Use Cases

\- Prototyping\: Quickly create UI mockups and interactive demos
\- Learning\: Generate code examples to understand concepts
\- Visualization\: Create charts\, diagrams\, and data visualizations
\- Games\: Build simple browser games and interactive experiences
\- Tools\: Generate calculators\, converters\, and utility applications

\#\# Source

The implementation is in the repository\:

You can’t perform that action at this time\.