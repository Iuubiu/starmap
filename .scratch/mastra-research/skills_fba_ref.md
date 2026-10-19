# Skills | File-based Agents | Mastra Docs

\# Skills

A file\-based agent discovers skills from itsskills\/ directory and bundles them at build time\. Skills are reusable procedures or reference material that the agent can load when relevant\, instead of putting every detail into the always\-on prompt\.

Use this page for the file\-based convention\. For code\-defined skills\, see Agent skills\. For theSKILL\.md package format\, see Workspace skills\.

\#\# QuickstartDirect link to Quickstart

The simplest skill is one markdown file underskills\/\. The filename becomes the skill name\, and description tells the agent when to load it\.

src\/mastra\/agents\/weather\/skills\/temperature\-units\.md

description\: Use when reporting temperatures or comparing forecast units\.

Always report temperatures in Celsius and Fahrenheit\. Include the user\'s preferred unit first when known\.

\#\# Skills vs tools vs instructionsDirect link to Skills vs tools vs instructions

Need \| Use \| Why 
\-\-\-\|\-\-\-\|\-\-\-
Always\-on identity\, tone\, or rules \| instructions\.md \| The model should see the guidance every turn\. 
Callable action with inputs and outputs \| tools\/ \| The model needs to execute code or call APIs\, including operations that perform side effects\. 
Detailed reference or procedure loaded when relevant \| skills\/ \| The model only needs the full guidance for specific tasks\. 

\#\# Skill formatsDirect link to Skill formats

Mastra supports three file\-based skill formats\:

Format \| Use it when 
\-\-\-\|\-\-\-
TypeScript\/JavaScript module \| You want to default\-export a createSkill\(\) result from code\. 
Packaged SKILL\.md directory \| The skill has instructions plus supporting files under references\/\. 
Flat markdown file \| The skill is one markdown file with frontmatter and instructions\. 

For packaged skills\,description is required in SKILL\.md frontmatter\. Flat markdown skills also require description in frontmatter\. Write when to use the skill\, not only what the skill contains\.

\#\# What gets loadedDirect link to What gets loaded

File\-based Agent skills are added to the generated bundle at build time\, so the deployed agent doesn\'t read them from disk\.

For packaged skills\, Mastra reads\:

\- SKILL\.md for metadata and instructions\.
\- Files directly underreferences\/ as supporting reference content\.

Reference files are keyed by filename\. Symlinked files and directories underreferences\/ are skipped during discovery\.

\#\# Precedence with configDirect link to Precedence with config

Discovered skills merge with anyskills in config\.ts\. On a name collision\, config\.skills wins and a warning is logged\.

Ifconfig\.skills is a function\, discovered skills are ignored with a warning because function\-valued skills can\'t be statically merged\.