# Agents | Playwright

\# Playwright Test Agents

\#\# Introduction

Playwright comes with three Playwright Test Agents out of the box\: 🎭 planner\, 🎭 generator and 🎭 healer\.

These agents can be used independently\, sequentially\, or as the chained calls in the agentic loop\. Using them sequentially will produce test coverage for your product\.

\- 🎭 planner explores the app and produces a Markdown test plan
\- 🎭 generator transforms the Markdown plan into the Playwright Test files
\- 🎭 healer executes the test suite and automatically repairs failing tests

\#\#\# Getting Started

Start with adding Playwright Test Agent definitions to your project using theinit\-agents command\. These definitions should be regenerated whenever Playwright is updated to pick up new tools and instructions\.

\- VS Code
\- Claude Code
\- Codex
\- OpenCode

npx playwright init\-agents \-\-loop\=vscode
npx playwright init\-agents \-\-loop\=claude
npx playwright init\-agents \-\-loop\=codex
npx playwright init\-agents \-\-loop\=opencode

note

VS Code v1\.105 \(released October 9\, 2025\) is needed for the agentic experience to function properly in VS Code\.

Once the agents have been generated\, you can use your AI tool of choice to command these agents to build Playwright Tests\.

\#\# 🎭 Planner

Planner agent explores your app and produces a test plan for one or many scenarios and user flows\.

Input

\- A clear request to the planner \(e\.g\.\, “Generate a plan for guest checkout\.”\)
\- Aseed test that sets up the environment necessary to interact with your app
\- \(optional\) A Product Requirement Document \(PRD\) for context

Prompt
\- Notice how the
seed\.spec\.ts is included in the context of the planner\.\- Planner will run this test to execute all the initialization necessary for your test including the global setup\, project dependencies and all the necessary fixtures and hooks\.

\- Planner will also use this seed test as an example of all the generated tests\. Alternatively\, you can mention the file name in the prompt\.

Example\: seed\.spec\.ts
import \{ test\, expect \} from \'\.\/fixtures\'\;

test\(\'seed\'\, async \(\{ page \}\) \=\> \{
  \/\/ this test uses custom fixtures from \.\/fixtures
\}\)\;

Output

\- A Markdown test plan saved asspecs\/basic\-operations\.md\.
\- The plan is human\-readable but precise enough for test generation\.

\#\# Example\: specs\/basic\-operations\.md

\#\# 🎭 Generator

Generator agent uses the Markdown plan to produce executable Playwright Tests\. It verifies selectors and assertions live as it performs the scenarios\. Playwright supports generation hints and provides a catalog of assertions for efficient structural and behavioral validation\.

Input

\- Markdown plan fromspecs\/

Prompt
\- Notice how the
basic\-operations\.md is included in the context of the generator\.\- This is how generator knows where to get the test plan from\. Alternatively\, you can mention the file name in the prompt\.

Output

\- A test suite undertests\/
\- Generated tests may include initial errors that can be healed automatically by the healer agent

\#\# Example\: tests\/add\-valid\-todo\.spec\.ts

\#\# 🎭 Healer

When the test fails\, the healer agent\:

\- Replays the failing steps
\- Inspects the current UI to locate equivalent elements or flows
\- Suggests a patch \(e\.g\.\, locator update\, wait adjustment\, data fix\)
\- Re\-runs the test until it passes or until guardrails stop the loop

Input

\- Failing test name

Prompt

Output

\- A passing test\, or a skipped test if the healer believes that functionality is broken\.

\#\# Artifacts and Conventions

The static agent definitions and generated files follow a simple\, auditable structure\:
repo\/
  \.github\/                    \# agent definitions
  specs\/                      \# human\-readable test plans
    basic\-operations\.md
  tests\/                      \# generated Playwright tests
    seed\.spec\.ts              \# seed test for environment
    tests\/create\/add\-valid\-todo\.spec\.ts
  playwright\.config\.ts

\#\#\# Agent Definitions

Under the hood\, agent definitions are collections of instructions and MCP tools\. They are provided by Playwright and should be regenerated whenever Playwright is updated\.

Example for Claude Code subagents\:
npx playwright init\-agents \-\-loop\=vscode

\#\#\# Specs inspecs\/

Specs are structured plans describing scenarios in human\-readable terms\. They include steps\, expected outcomes\, and data\. Specs can start from scratch or extend a seed test\.

\#\#\# Tests intests\/

Generated Playwright tests\, aligned one\-to\-one with specs wherever feasible\.

\#\#\# Seed testsseed\.spec\.ts

Seed tests provide a ready\-to\-usepage context to bootstrap execution\.