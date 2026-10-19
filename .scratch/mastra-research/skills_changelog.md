# Mastra Changelog 2026-02-19 | Mastra Blog

\# Mastra Changelog 2026\-02\-19

A new reusable Harness orchestration layer for agent apps\, versioned workspaces and skills\, pluggable blob storage\, security and discovery upgrades\, plus improved tool I\/O and streaming behavior\, including better chunk handling\.

Shane Thomas·

Feb 19\, 2026
·
9 min read

We’ve been busy tightening up the foundations for building real agent apps\, especially around storage\, orchestration\, and workspace ergonomics\. If you run agents against codebases or ship apps with complex agent flows\, there’s a lot here for you\.

Release\:\@mastra\/core\@1\.5\.0

Let\'s dive in\:

\#\# Core Harness\, a reusable orchestration layer for agent apps

There’s a new generic Harness in \@mastra\/core that you can use as the backbone for agent\-powered applications\. It’s designed to consolidate the “agent app plumbing” you usually end up rebuilding\: modes\, state\, built\-in tools\, subagent support\, memory integration\, model discovery\, tool approval\, and event\-driven runtime management\.

If your app has multiple modes \(for example\, “chat”\, “plan”\, “execute”\)\, needs heartbeat monitoring\, or needs consistent thread lifecycle handling\, Harness gives you a shared\, reusable surface area instead of a pile of custom glue code\.

Harness includes\:

\- Modes and state management
\- Built\-in tools like ask\_user and submit\_plan
\- Subagent support
\- Observational Memory integration
\- Model discovery
\- Permission\-aware tool approval
\- Thread management\, heartbeat monitoring\, and an event\-driven architecture

MastraCode has also been migrated off the prototype harness to this new generic Core Harness\, and createMastraCode is now fully configurable \(modes\, subagents\, storage\, tools\, etc\) \(PR \#13245\)\.

\#\# Versioned Workspaces and Skills plus pluggable Blob Storage \(S3 and DB\-backed\)

Mastra now has first\-class storage domains for workspaces and skills\, including CRUD and versioning across common databases\. On top of that\, skills get a filesystem\-native draft to publish workflow backed by a content\-addressable BlobStore\, including S3 support via S3BlobStore\.

That combination is a big step toward treating agent context and reusable skills like deployable artifacts\. You can iterate locally\, publish immutable versions\, and reliably hydrate the same workspace and skill versions at runtime\.

A few details that tie it all together\:

\- Workspaces and skills storage domains ship with implementations for LibSQL\, Postgres\, and MongoDB \(PR \#13156\)\.
\- Skills can be discovered more flexibly\, including glob\-based discovery and direct path discovery \(point directly at a skill directory or a SKILL\.md\) \(PR \#13023\, PR \#13031\)\.
\- Skill discovery is more resilient\, if a configured skills path is inaccessible \(permission denied\, etc\)\, Mastra logs a warning instead of failing all discovery \(PR \#13031\)\.
\- Server\-side handlers now correctly remove glob\-discovered skills\, and support mount\-aware skill installation when using CompositeFilesystem mounts \(PR \#13023\, PR \#13031\)\.

Example skills discovery with globs \(including deep discovery\)\:

Example direct skill path discovery\:

\#\# Workspace capability upgrades \(security\, discovery\, and search\)

Workspaces got a strong set of upgrades that make them safer to run in production\, easier to configure for large repos\, and better at “finding stuff” when agents need it\.

\#\#\# Least\-privilege filesystem access with allowedPaths

LocalFilesystem now supports allowedPaths\, so you can grant access to specific directories outside basePath without turning off containment entirely\. That’s a big deal for real apps where agents need to read a config directory\, a shared docs directory\, or a mounted secrets location\, but you still want strict boundaries everywhere else\.

You can also update allowed paths at runtime\:

\#\#\# Glob\-based workspace configuration \(listing\, indexing\, and skills discovery\)

Workspaces now support glob patterns in several places\:

\- list\_files tool accepts a pattern to filter results
\- autoIndexPaths accepts globs to selectively index content for BM25 search
\- skills paths support globs\, including discovery in dot\-directories like \.agents\/skills

list\_files with a pattern\:

autoIndexPaths with globs\:

\#\#\# Regex search with mastra\_workspace\_grep

A new workspace tool\, mastra\_workspace\_grep\, provides fast regex\-based search across files\. This complements semantic search when you need exact pattern matching\, quick greps for symbols\, or to find specific strings without paying embedding costs\.

The tool is automatically available when a workspace has a filesystem configured\:

Mastra Server also registers the grep tool in the Studio workspace tools listing so it shows up in the agent metadata UI \(PR \#13010\)\.

\#\# Better tool I\/O and streaming behavior in the agent loop

Tool results are often the biggest source of token waste and the biggest source of “weird stream behavior”\. This release tackles both\.

\#\#\# toModelOutput for token\-efficient tool outputs

Tools can now define toModelOutput to transform raw tool results into model\-friendly content\, while still persisting the raw outputs in storage\. This matches the Vercel AI SDK convention\, so you can keep your tool outputs structured and rich\, without forcing the model to ingest giant JSON blobs\.

\#\#\# Workspace tools now return raw text\, metadata moves to stream chunks

Workspace tools removed outputSchema and now return raw text instead of JSON\, which typically reduces token usage and improves LLM performance\. Structured metadata that used to be returned is now emitted as data\-workspace\-metadata chunks via writer\.custom\(\)\, so your UI can still access it without sending it to the model\.

Workspace tools were also extracted into individual files so they can be imported directly\:

\#\#\# Streaming reliability improvements and more resilient loops

A set of fixes make streaming and tool execution behave more predictably\:

\- onChunk now receives raw Mastra chunks \(not AI SDK v5 converted chunks\) for tool results\, and missing onChunk calls were added for tool\-error and mixed\-error scenarios \(PR \#13243\)
\- Tool execution errors no longer stop the agent loop\, the model can see the error and retry with corrected arguments \(PR \#13242\)
\- Tool execution errors are correctly emitted as tool\-error chunks \(not tool\-result\) in fullStream\, which helps downstream consumers distinguish success vs failure \(PR \#13147\)
\- requestContext is now forwarded into tool executions at runtime\, so tools invoked inside workflows receive the same auth context\, feature flags\, and user metadata as the caller \(PR \#13094\)

\#\# Breaking Changes

Workspace tools return raw text instead of JSON \(PR \#13166\)\: Workspace tools removed outputSchema and no longer return structured JSON payloads\. If you were relying on fields from the old JSON output\, migrate by reading the raw text return value for the model\-facing path\, and consume structured metadata from data\-workspace\-metadata stream chunks in your UI\.

\#\# Other Notable Updates

\- Typed workspace providers\: workspace\.filesystem and workspace\.sandbox now return the concrete types you passed to the Workspace constructor\, improving autocomplete and removing the need for casts\. Mount\-aware workspaces get per\-key narrowing via mounts\.get\(\) \(PR \#13021\)
\- AnyWorkspace exported\: Exported AnyWorkspace from \@mastra\/core\/workspace\, and updated Agent and Mastra to accept workspaces with typed mounts or sandbox without type errors \(PR \#13155\)
\- Vercel AI Gateway support\: The model router now supports Vercel AI Gateway identifiers like model\: \'vercel\/google\/gemini\-3\-flash\' \(PR \#13149\)
\- Observational Memory instructions\: Added instruction\?\: string to observational memory config types so you can extend observer and reflector prompts \(PR \#13240\)
\- Skill processor approval behavior\: Internal skill processor tools now bypass requireToolApproval checks\, preventing them from being incorrectly suspended for approval \(PR \#13160\)
\- Tracing fix for requestContext\: requestContext metadata is now propagated to child spans\, not just root spans \(fixes \#12818\) \(PR \#12819\)
\- Semantic recall search fix\: SemanticRecall now probes embedding dimensions to avoid mismatched index naming with non\-default embedding sizes \(fixes \#13039\) \(PR \#13059\)
\- CompositeFilesystem instructions corrected\: Agents and tools no longer receive incorrect guidance about sandbox paths for mounted filesystems \(PR \#13221\)
\- Tool approval resume flow\: Sub\-agent tool approval now resumes instead of restarting from scratch\, preventing infinite loops \(PR \#13241\)
\- Workflow streaming processors\: Fixed writer being undefined in processOutputStream\, enabling output processors to emit custom stream events during processing \(PR \#13056\)
\- TypeScript build stability\: Reduced tsc memory usage by shrinking generated \.d\.ts output\, and improved tool type inference performance by switching ZodLikeSchema to structural typing \(PR \#13229\, PR \#13239\)
\- Thread title generation fix\: Pre\-created threads now correctly trigger title generation when they have no title \(resolves \#13145\) \(PR \#13151\)
\- Workflow typing\: inputData in dowhile and dountil loop condition functions is now typed as the step output schema instead of any \(PR \#12977\)
\- Workflow resume correctness\: Fixed \.branch\(\) conditions receiving undefined inputData when resuming suspended nested workflows after \.map\(\) \(fixes \#12982\) \(PR \#13055\)

That\'s all for \@mastra\/core\@1\.5\.0\!

Happy building\! 🚀

Share on X or LinkedIn

Shane Thomas is the founder and CPO of Mastra\. He co\-hosts AI Agents Hour\, a weekly show covering news and topics around AI agents\. Previously\, he was in product and engineering at Netlify and Gatsby\. He created the first course as an MCP server and is kind of a musician\.
All articles by Shane Thomas →