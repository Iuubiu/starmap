# Skills | Mastra Docs

\# Filesystem\-backed skills

Filesystem\-backed skills are directories of reusable instructions and supporting files\. Mastra discovers them from paths in theskills option\, then makes them available to every agent using that configuration\. Skills follow the Agent Skills specification\.

Use agent skills instead when you want to define a skill directly in one agent\'s code\. An agent can use both types\. If a direct agent skill and a filesystem\-backed skill have the same name\, the direct agent skill takes precedence\.

\#\# QuickstartDirect link to Quickstart

Create a directory with aSKILL\.md file\:

workspace\/skills\/code\-review\/SKILL\.md

name\: code\-review
description\: Reviews code for bugs and readability issues

\# Code review

Check the code for bugs\, missing error handling\, and unclear naming\.

Configure the directory\:

src\/mastra\/workspaces\.ts
import \{ LocalFilesystem\, Workspace \} from \'\@mastra\/core\/workspace\'

export const workspace \= new Workspace\(\{
  filesystem\: new LocalFilesystem\(\{
    basePath\: \'\.\/workspace\'\,
  \}\)\,
  skills\: \[\'skills\'\]\,
\}\)

Theskills path is relative to the filesystem root\, so Mastra discovers \.\/workspace\/skills\/code\-review\/SKILL\.md\. An agent using this configuration can now discover and load code\-review when a request needs it\.

\#\# Skill structureDirect link to Skill structure

Each skill is a directory with a requiredSKILL\.md file\. It can also contain supporting files\:

workspace\/skills\/code\-review
code\-review\/
  SKILL\.md
  references\/
    style\-guide\.md
  scripts\/
    lint\.ts
  assets\/
    review\-template\.md

\- SKILL\.md\: Metadata and instructions that Mastra loads when the agent selects the skill
\- references\/\: Documentation that the agent can read or search as needed
\- scripts\/\: Scripts used by the skill
\- assets\/\: Templates\, images\, and other supporting files

Keep the main workflow inSKILL\.md\. Move detailed material to references\/ so the agent only reads it when needed\.

\#\# SKILL\.md formatDirect link to skillmd\-format

The YAML frontmatter requiresname and description\. The name must match the skill directory name\, contain at most 64 lowercase letters\, numbers\, or hyphens\, not start or end with a hyphen\, and not contain consecutive hyphens\. The Markdown body contains the instructions returned to the agent when it loads the skill\.

Mastra also reads the optionallicense\, compatibility\, user\-invocable\, and metadata fields\. See the Agent Skills specification for the complete package format and field guidance\.

\#\# How agents use skillsDirect link to How agents use skills

When skills are configured\, Mastra adds each skill\'s name\, description\, path\, and source type to the system message\. This lets the agent discover available skills without loading every instruction file into its context\.

Mastra also gives the agent three tools\:

Tool \| Does 
\-\-\-\|\-\-\-
skill \| Loads a skill\'s SKILL\.md instructions and lists its reference\, script\, and asset files\. 
skill\_read \| Reads all or part of any file under the selected skill directory\. 
skill\_search \| Searches skill instructions and reference files\. 

Loading is stateless\. The instructions remain in the conversation as a tool result\, and the agent can callskill again if they leave the context after compaction\.

\#\# Configure skill pathsDirect link to Configure skill paths

Theskills array accepts several path forms\:

Path \| Discovery behavior 
\-\-\-\|\-\-\-
skills \| Scans each immediate subdirectory for a SKILL\.md file\. 
skills\/code\-review \| Loads one skill directory directly\. 
skills\/code\-review\/SKILL\.md \| Loads one skill file directly\. 
\.\/\*\*\/skills \| Finds matching directories\, then discovers skills under each one\. 
\.\/\*\*\/SKILL\.md \| Finds and loads matching skill files\. 

Add more entries to discover skills from several roots\, such as project\, team\, or package directories\.

Glob traversal is limited to four directory levels below the glob base\.

Paths use the configured filesystem when one is available\. Without a filesystem\, Mastra reads them from local disk relative to the application process\'s current working directory\. An explicitskillSource replaces both defaults\.

\#\# Same\-named skillsDirect link to Same\-named skills

Mastra lists every distinct filesystem\-backed skill in the system message\, including its path and source type\. If several skills have the same name\, a lookup by name uses this priority\:

\- Local project paths
\- Managed paths under\.mastra\/skills
\- External paths undernode\_modules

If multiple highest\-priority candidates have the same source type\, Mastra can\'t choose between them and throws an error\. Rename one skill or move it to a different source type\.

The agent can bypass name\-based resolution by passing the exact path shown in the system message toskill or skill\_read\. Paths with or without the trailing \/SKILL\.md work\. If several configured paths resolve to the same canonical directory\, Mastra treats them as aliases and lists the skill once\.

Direct agent skills are resolved before filesystem\-backed skills\. A direct skill wins when both types use the same name\.

\#\# Search skill contentDirect link to Search skill content

When BM25 or vector search is configured alongside skills\, Mastra automatically indexes each skill\'sSKILL\.md instructions and reference files\. Scripts and assets aren\'t indexed\.

Without BM25 or vector search\,skill\_search falls back to case\-insensitive text matching across the instructions and references\. This keeps skill search available without a separate search configuration\, while indexed search provides ranking and semantic retrieval for larger collections\.

\#\# Dynamic skill pathsDirect link to Dynamic skill paths

Pass a synchronous or asynchronous function when the available paths depend on request context\. This example adds development skills for users with thedeveloper role\:

src\/mastra\/workspaces\.ts
import \{ LocalFilesystem\, Workspace \} from \'\@mastra\/core\/workspace\'

const workspace \= new Workspace\(\{
  filesystem\: new LocalFilesystem\(\{ basePath\: \'\.\/workspace\' \}\)\,
  skills\: \(\{ requestContext \}\) \=\> \{
    const paths \= \[\'skills\'\]

    if \(requestContext\?\.get\(\'user\-role\'\) \=\=\= \'developer\'\) \{
      paths\.push\(\'developer\-skills\'\)
    \}

    return paths
  \}\,
\}\)

Mastra resolves the function for each execution and gives the agent the skill set for that request\. The returned paths support the same directory\, file\, and glob forms as a static array\.

\#\# Custom skill sourcesDirect link to Custom skill sources

SetskillSource when skills should come from a backend other than the configured filesystem or local disk\. A custom source handles skill discovery and file reads for every configured path\.

For example\,CompositeVersionedSkillSource mounts published skill versions from a content\-addressable blob store under directories where Mastra can discover them\:

src\/mastra\/workspaces\.ts
import \{ CompositeVersionedSkillSource\, Workspace \} from \'\@mastra\/core\/workspace\'

const skillSource \= new CompositeVersionedSkillSource\(
  \[
    \{
      dirName\: \'code\-review\'\,
      tree\: versionTree\,
      versionCreatedAt\,
    \}\,
  \]\,
  blobStore\,
\)

const workspace \= new Workspace\(\{
  skills\: \[\'\.\'\]\,
  skillSource\,
\}\)

An explicitskillSource doesn\'t fall back to the configured filesystem or local disk when a path is missing\. See the configuration reference for the source interface and related options\.