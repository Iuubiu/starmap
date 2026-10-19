# Perplexity Output UX: Structured Answers & Follow-Ups
https://aiuxplayground.com/gallery/perplexity-output/

NewsletterJoin 2K\+ AI designers and PMs on Substack\. New teardowns\, patterns\, and prompts as they drop\.

Perplexity

\# Perplexity output UX\: tabs\, follow\-ups \& export

One query spawns multiple views on the same result\, so users pivot between prose\, links\, and images without re\-searching\. Follow\-ups\, rewrite modes\, and selection refinement extend the session instead of forcing a fresh thread\. Source audit and citation depth live in the citations teardown under Trust\.

\#\# Structured answers with tabbed views

\#\#\# What works

\- Long answers use clear hierarchy \, summary\, “Current favorites” list\, “Best single guess” \, without leaving the thread\.
\- Answer \/ Links \/ Images tabs let users switch modality without re\-querying\.
\- Completed N steps label signals research happened before the prose appears\.

\#\#\# What we would push on

\- Tabs compete with the answer for attention on first load\. Default tab must carry the full story for skimmers\.

\#\#\# Product bet

Perplexity treats each query as a small report\, not a chat bubble\. Tabbed views let users audit links and images without re\-running search\, which supports the product’s research\-first positioning over generic chat\.

\#\#\# Tradeoff

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Answer \/ Links \/ Images tabs on one result \| Multiple views without re\-querying \| Tabs compete with prose for attention on first load 

\#\#\# Takeaway

Treat search output as a small report\: structured prose plus parallel Links and Images views\.

\#\# Research steps before the answer

\#\#\# What works

\- Steps collapse by default so the answer stays primary\; expand reveals concrete actions taken\.
\- Plain\-language step names \(Searching the web\) beat opaque tool names for trust\.
\- Step count in the header sets expectation for latency on complex queries\.

\#\#\# What we would push on

\- Collapsed steps are easy to miss\. High\-stakes queries may need a stronger “we searched N sources” cue inline\.

\#\#\# Product bet

Visible research steps justify wait time and build trust before users read claims\. For a search product\, showing retrieval happened is as important as the prose itself\.

\#\#\# Tradeoff

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Collapsed research steps with expandable detail \| Answer stays primary\; auditors can expand \| Easy to miss on fast scroll or casual queries 

\#\#\# Takeaway

Show what the system did before answering\, collapsed\, expandable\, in human terms\.

\#\# Follow\-up chips after the answer

\#\#\# What works

\- Follow\-ups are contextual \, squad leaders\, France form\, betting odds \, not generic “tell me more\.”
\- Each chip is one tap into the composer\; users iterate without rephrasing the original question\.
\- Sources row \(favicons \+ count\) sits beside share\/copy\/rewrite actions on the same answer block\.

\#\#\# What we would push on

\- Long follow\-up lists push the composer down\. Cap visible chips or collapse after three\.

\#\#\# Product bet

Contextual follow\-up chips drive session depth without blank composer anxiety\. Each chip is another query Perplexity can monetize on Pro tiers with heavier modes\.

\#\#\# Tradeoff

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Contextual follow\-up chips below each answer \| Iteration without rephrasing\; drives session depth \| Long chip lists push the composer down 

\#\#\# Takeaway

Pair a complete first answer with specific next questions\, refinement without blank follow\-up boxes\.

\#\# Images tab for visual evidence

\#\#\# What works

\- Images tab reuses the same query \, brackets\, experts\, trophy photos \, without a separate image search\.
\- Domain label under each thumbnail ties visuals back to provenance\.
\- Grid layout supports scan\-first research\; click\-through opens the source image\.

\#\#\# What we would push on

\- Image quality varies by query\. No inline caption explains why each image was selected\.

\#\#\# Product bet

A dedicated Images tab keeps visual research inside Perplexity instead of sending users to Google Images\. Domain labels reinforce the citation\-first brand on non\-text evidence\.

\#\#\# Tradeoff

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Images tab as peer view beside Answer and Links \| Visual evidence without a separate image search \| No caption explaining why each image was selected 

\#\#\# Takeaway

When answers are visual \(sports\, products\, places\)\, give a dedicated Images view beside prose\.

\#\# Export PDF\, Markdown\, or DOCX

\#\#\# What works

\- Export sits in the per\-answer action row \, share\, download\, copy\, rewrite \, not buried in settings\.
\- Three formats cover slide decks \(PDF\)\, docs \(DOCX\)\, and dev workflows \(Markdown\)\.
\- Download targets the current answer\, not the whole thread\.

\#\#\# What we would push on

\- Export may strip citation links depending on format\, verify sources survive in PDF\/DOCX\.

\#\#\# Product bet

Per\-answer export lets users ship research into their real workflows \(slides\, docs\, repos\) without copy\-paste\. That makes Perplexity sticky beyond the browser tab\.

\#\#\# Tradeoff

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Per\-answer export to PDF\, Markdown\, and DOCX \| Answers leave chat in workflow\-native formats \| Citation links may not survive all export formats 

\#\#\# Takeaway

Let users ship the answer out of chat in the format their workflow expects\.

\#\# Rewrite with mode and model picks

\#\#\# What works

\- Rewrite regenerates the same question with a different depth or model\, not a new thread\.
\- Modes are labeled by outcome \(Deep research\, Learn step by step\) with lock icons for Pro tiers\.
\- Current mode \(Search\) shows a checkmark so users know what produced this answer\.

\#\#\# What we would push on

\- Model names \(Sonar\, GPT\-5\.4\) mean little to casual users\. Pair with one\-line capability hints\.

\#\#\# Product bet

Rewrite with explicit mode and model choice is how Perplexity upsells Pro tiers and justifies compute on heavier runs\. Users re\-ask the same question with different depth instead of starting over\.

\#\#\# Tradeoff

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Rewrite with labeled modes and model picker \| Non\-destructive retry with clear depth knobs \| Model names opaque to casual users 

\#\#\# Takeaway

Non\-destructive rewrite with explicit mode\/model choice beats “try again” with no knobs\.

\#\# Thumbs up with quality chips

\#\#\# What works

\- Thumbs up opens structured praise\, Good sources is explicit for a search product\.
\- All chips optional\; users can submit without categorizing\.
\- Thank\-you toast confirms receipt without blocking the thread\.

\#\#\# What we would push on

\- Modal interrupts flow for simple satisfaction\. One\-tap up with optional expand might feel faster\.

\#\#\# Product bet

Good sources in the positive taxonomy trains retrieval quality directly\. For a citation product\, praise should distinguish accurate prose from accurate sourcing\.

\#\#\# Tradeoff

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Structured quality chips on thumbs up \| Source\-quality signal in praise taxonomy \| Modal interrupts flow for simple satisfaction 

\#\#\# Takeaway

On search answers\, include source\-quality in positive feedback taxonomy\.

\#\# Thumbs down flags wrong sources

\#\#\# What works

\- Wrong sources is first\-class\, critical for a product whose value is citation quality\.
\- Length chips \(Too long \/ Too short\) separate formatting issues from factual ones\.
\- Optional modal keeps downvote fast while still capturing structured signal\.

\#\#\# What we would push on

\- No way to flag a specific citation inline from the feedback modal\. Users must remember which source failed\.

\#\#\# Product bet

Wrong sources as a first\-class chip routes retrieval failures separately from writing quality\. That is core signal for a product built on cited answers\.

\#\#\# Tradeoff

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Wrong sources chip in negative feedback \| Citation failures routable separately from Inaccurate \| No per\-citation flag from the modal 

\#\#\# Takeaway

Negative feedback on search products needs a source\-specific issue type\.

\#\# Selection → follow\-up or check sources

\#\#\# What works

\- Users can select prose inside the answer\, not just react to the whole block\.
\- Add to follow\-up scopes the next query\; Check sources jumps to evidence for that claim\.
\- Split actions match intent\: iterate vs verify\.

\#\#\# What we would push on

\- Selection menu is discoverable only after highlighting\. No persistent hint for new users\.

\#\#\# Product bet

Selection splits iterate \(follow\-up\) from verify \(check sources\) on the same span\. That keeps skeptical users auditing claims without re\-running the whole query\.

\#\#\# Tradeoff

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Selection menu with Add to follow\-up vs Check sources \| Iterate and verify on the same span \| Discoverable only after highlighting 

\#\#\# Takeaway

Pair refinement \(follow\-up\) with verification \(check sources\) on the same selection\.

\#\# How output fits with citations

\#\#\# The pattern

\- Report\-first output\: tabbed Answer \/ Links \/ Images\, visible research steps\, structured prose with inline chips\.
\- Refinement via follow\-up chips\, Rewrite with mode\/model picks\, export\, and selection actions\.
\- Feedback taxonomy includes source quality \(Good sources\, Wrong sources\)\.

\#\#\# Where it varies

\- Modality\: Answer prose vs Links audit vs Images grid on the same query\.
\- Refinement path\: follow\-up chip vs Rewrite mode vs selection → check sources\.
\- Citation depth lives in the citations teardown\; output covers the answer shell those chips sit in\.

\#\#\# Product bet

Perplexity favors search iteration\: new focus\, rewrite mode\, or a follow\-up chip rather than editing one bubble in place\. The output layer is a report users can audit\, export\, and refine\; the citations layer is the evidence stack underneath\.

\#\#\# Tradeoffs

Decision \| Benefit \| Cost 
\-\-\-\|\-\-\-\|\-\-\-
Answer \/ Links \/ Images tabs on one result \| Multiple views without re\-querying \| Tabs compete with prose for attention on first load 
Collapsed research steps with expandable detail \| Answer stays primary\; auditors can expand \| Easy to miss on fast scroll or casual queries 
Contextual follow\-up chips below each answer \| Iteration without rephrasing\; drives session depth \| Long chip lists push the composer down 
Images tab as peer view beside Answer and Links \| Visual evidence without a separate image search \| No caption explaining why each image was selected 
Per\-answer export to PDF\, Markdown\, and DOCX \| Answers leave chat in workflow\-native formats \| Citation links may not survive all export formats 
Rewrite with labeled modes and model picker \| Non\-destructive retry with clear depth knobs \| Model names opaque to casual users 
Structured quality chips on thumbs up \| Source\-quality signal in praise taxonomy \| Modal interrupts flow for simple satisfaction 
Wrong sources chip in negative feedback \| Citation failures routable separately from Inaccurate \| No per\-citation flag from the modal 
Selection menu with Add to follow\-up vs Check sources \| Iterate and verify on the same span \| Discoverable only after highlighting 

\#\#\# Takeaway

Perplexity’s output model is report\-first with layered refinement and source\-aware feedback\. Copy tabbed views and rewrite knobs\; pair with the citations teardown for the full evidence stack\.

\#\# Takeaways

\#\#\# Copy this

\- Answer \/ Links \/ Images tabs on one result
\- Collapsed research steps with expandable detail
\- Contextual follow\-up chips after long answers
\- Per\-answer export to PDF\, Markdown\, and DOCX
\- Rewrite with labeled modes and model picker
\- Good sources and Wrong sources in feedback chips
\- Selection → Add to follow\-up vs Check sources

\#\#\# Skip this

\- Hiding Links and Images so deeply users never audit results
\- Generic follow\-ups \(“Explain more”\) on factual search answers
\- Rewrite with no indication of current mode or model
\- Feedback forms with no source\-quality category