# logseq-encode-garden/pages/Claude___Desktop___Capability___AI-powered artifacts.md at main · codekiln/logseq-encode-garden
https://github.com/codekiln/logseq-encode-garden/blob/main/pages/Claude___Desktop___Capability___AI-powered%20artifacts.md

Skip to content

\#\# Navigation Menu

\{\{ message \}\}

\#\# Repository navigation

\# Claude\_\_\_Desktop\_\_\_Capability\_\_\_AI\-powered artifacts\.md

\# Claude\_\_\_Desktop\_\_\_Capability\_\_\_AI\-powered artifacts\.md

\#\# File metadata and controls

42 lines \(41 loc\) · 4\.48 KB

title\:\: Claude\/Desktop\/Capability\/AI\-powered artifacts see\-also\:\: \[\[Claude\/Desktop\]\]\, \[\[Claude\/Code\]\]\, \[\[MCP\]\] date\-created\:\: 2026\-05\-28

\#\# Setting

\- Location\: profile \(initials or name\, lower left\) → Settings → Capabilities → AI\-powered artifacts
\- UI copy\: “Build apps and interactive documents that use Claude inside the artifact\.”
\- Prerequisite\: Artifacts must be enabled on the same Capabilities screen\. To turn artifacts off\, disable AI\-powered artifacts first\, then Artifacts\.
\- Surfaces\: same capability toggle on \[\[Claude\/Desktop\]\] and Claude on the web \(claude\.ai\/settings\/capabilities\)\. Team and Enterprise admins may restrict artifact settings org\-wide\.

\#\# What it enables

\- Standard artifacts show substantial standalone content \(code\, HTML\, React\, diagrams\, documents\) in a side panel next to chat\.
\- AI\-powered artifacts go further\: Claude\-generated code calls Claude inside the artifact via a hosted text\-based API\, so the artifact becomes a small interactive app \(Q\&A\, coaching\, games\, agents that chain multiple Claude calls\) rather than only static rendered output\.
\- Anthropic hosts and runs the app\; the builder does not deploy infrastructure or supply API keys for end users\.

\#\# How to build

\- Enable Artifacts and AI\-powered artifacts under Capabilities\.

\- Describe the app in chat \(e\.g\. “let’s build an AI image analyzer in React”\)\.

\- Claude writes orchestration code\; preview and iterate in the artifact panel \(view code\, copy\, download\, version selector\, “Try fixing with Claude” on errors\)\.

\- Share via link when ready\; recipients use their own Claude account—no API keys for them\, no usage billed to the creator\.

\#\# Usage and sharing economics

\- Creator\: sharing is free regardless of audience size\; creator does not pay for visitors’ Claude calls inside the artifact\.
\- End user\: signs in with their Claude account\; API\-style usage inside the artifact counts against their subscription limits\, not the author’s\.
\- Team \/ Enterprise \(in\-org sharing\)\: org members can use shared AI\-powered artifacts without extra cost to the creator \(per help center\)\.

\#\# Related artifact capabilities \(2026\)

\- Help center \(updated 2026\-03\-24\) documents additional artifact features on paid tiers \(web \+ desktop unless noted\)\:
\- MCP in artifacts \(Pro\, Max\, Team\, Enterprise\)\: artifacts can use configured MCP connectors \(Asana\, Google Calendar\, Slack\, custom remote MCP\)\. Each user approves and authenticates MCP independently\, including on published artifacts\.
\- Persistent storage \(Pro\+\)\: up to 20 MB per artifact\, text\-only\; personal vs shared storage modes\; storage works for published artifacts \(not during unpublished dev\/testing\)\. Unpublishing deletes stored data\.
\- Artifacts sidebar\: browse\, fork\, and manage creations\; publish and embed per Publishing and sharing artifacts\.

\- Launch blog \(2025\-07\-25\) introduced the feature as beta on Free\, Pro\, Max\; noted early limits \(no external API calls\, no persistent storage\, text completion API only\)\. Later product updates added storage\, MCP\, and broader plan coverage—treat the help center as current for limits\.

\- Help center \(updated 2026\-03\-24\) documents additional artifact features on paid tiers \(web \+ desktop unless noted\)\:

\#\# Contrasts

\- Standard artifactAI\-powered artifactOutputStatic or interactive UI without embedded Claude callsApp that invokes Claude for each user interactionHostingRendered in artifact panelRuns on Anthropic infrastructure with in\-artifact APISharing cost to authorN\/A \(content only\)No per\-user API charges to authorEnd\-user requirementsView\/export contentClaude account for in\-app AI features

\#\# Product announcement

\- Build and share AI\-powered apps with Claude \(2025\-07\-25\)\: positioning as build\/host\/share without scaling cost\; examples include adaptive games\, tutoring\, CSV analysis\, writing assistants\, multi\-step agent workflows\.

\#\# Footnotes

You can’t perform that action at this time\.