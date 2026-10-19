# Synthetic Users vs. Human Respondents: Same Conclusion, Less Variation

My Privacy Preferences \(Data Tracking\)

We use third\-party cookies to understand how visitors use our website\. Videos hosted by Vimeo and YouTube may require tracking cookies to play\.

To opt out of tracking\, check the box below \(this may prevent videos from playing\)\. To watch videos\, uncheck the box to opt back into tracking\. You can change your preferences at the Cookie Permissions link in our footer\. NN\/G will never sell or share your personal information\. Vimeo and YouTube have their own privacy policies that explain how they collect and use your information\.

Opt out of data tracking

\# Synthetic Users vs\. Human Respondents\: Same Conclusion\, Less Variation

Summary\: Data from AI\-generated respondents pointed to the same conclusion as a survey of 604 humans but contained far fewer distinct answers\.

More teams are turning to synthetic users \(AI\-generated stand\-ins for research participants\) to run studies without recruiting real people\. We’ve previously explored how synthetic users perform in interviews\. This time\, we wanted to test them on a more scoped task\: answering a single open\-ended question from a survey\.

To do this\, we reused a question from our earlier survey on UX terminology\, in which 604 tech and design professionals told us what name they’d use for UX work\. We posed the same question to 120 synthetic respondents and then compared the two datasets\. Both datasets led to the same overall conclusion\, but the synthetic responses varied much less than the human ones\.

\#\# How the Synthetic Respondents Were Generated

We obtained the synthetic responses in February 2026 using Synthetic Users\, a generative\-AI\-based platform that simulates research participants and their responses\.

We created 120 synthetic respondents intended to represent tech and design professionals worldwide\. We provided Synthetic Users with the research plan\, which included the research questions\, inclusion criteria\, exclusion criteria\, and survey questions\. Synthetic Users automatically assigned each respondent a profile with characteristics such as age\, location\, profession\, cultural background\, organizational structure\, and personality traits\.

We requested that the synthetic respondents be asked the same open\-ended question used in the original human\-participant study\:

Question\: Which professional field or discipline do you believe best describes the following work\?

An individual gathers insights about people’s needs and experiences and turns those insights into recommendations for how a product or service should be planned\, built\, and improved\.

Please name only 1 field or discipline\.

Two aspects of the platform were outside our control\. First\, Synthetic Users simulates interviews\, so the synthetic respondents answered as if speaking to an interviewer and often gave longer answers than the humans’ survey responses\. Second\, the platform sometimes reworded the question — for example\, asking about “people’s needs\, behaviors\, and experiences” rather than “people’s needs and experiences\.” Such rewording is probably meant to mimic how human interviewers rephrase questions in conversation\, but even small wording changes can prime respondents or shift how they interpret a question\, so we cannot rule out that they influenced the synthetic responses\.

These differences point to a broader limitation of synthetic\-user platforms\: researchers have limited control over how questions are presented and the presentation may be a confounding variable in the study\.

We analyzed the synthetic and human responses the same way\. Because some respondents named more than one field\, we coded each response for the keywords it contained rather than forcing it into a single category\.

\#\# The Synthetic and Human Data Converged on the Same Overall Result

Both datasets led to the same primary conclusion\: no alternative term has displaced UX as the dominant name for this type of work\.

Synthetic respondents were even more likely to use UX\-related terminology than human respondents\. This 14\-percentage\-point difference was statistically significant\, but it would not change the practical conclusion of our original study\: UX was clearly the dominant term in both datasets\.

This difference is worth considering in context\. Our human sample was recruited partly through our own channels\, such as our Practitioner Panel\. As we noted in the original study\, the recruitment likely resulted in a sample that was especially familiar with UX terminology and that may thus overestimate how commonly the term “UX” is used among tech and design professionals\.

The synthetic respondents were not recruited through these same channels and therefore did not have this particular sampling limitation\. In fact\, 67\% of the human dataset consisted of UX professionals\, compared with only 20\% of the synthetic dataset\. \(This difference was by design\: We established quotas for different professional roles when generating the synthetic sample to ensure representation across a broader range of professions\. The final synthetic sample closely matched these quotas\.\)

In theory\, the synthetic dataset offered an opportunity to represent a broader range of tech and design professionals\. Yet\, UX\-related terminology was even more common in the synthetic data than in our already UX\-familiar human sample\.

We cannot determine from this comparison exactly why this happened\. However\, previous research on synthetic respondents has found that their answers can be more concentrated around common or expected responses\, with less of the variation found among real people\.

\#\# Synthetic Respondents Used a Narrower Range of Terms\: Mode Collapse

The human respondents used a much wider range of terminology than the synthetic respondents\. Human participants used more than 50 distinct labels\, including “consumer\-behavior research\,” “digital\-experience strategy\,” “journey management\,” and “human\-factors engineering\.” Most of these alternatives appeared only once or\, at most\, a few times\.

Synthetic respondents\, by contrast\, collectively produced a much narrower set of responses\. The difference was most apparent in the less\-common answers\: synthetic respondents produced none of the unusual or specialized terms that appeared in the human data\, such as “digital management” or “business analysis\.”

This pattern resembles mode collapse — a machine\-learning term describing a generative model that keeps producing a narrow set of outputs instead of the full range it was trained on\. \(The name borrows the statistical sense of “mode”\: the most common value in a dataset\.\)

In synthetic\-users research\, mode collapse refers to synthetic data that reproduces the most common data point but drops the long tail of less\-common responses in the target human population\.

Our synthetic respondents collapsed onto a dozen labels\; the humans spread across more than 50\.

This narrower range is notable given the response format\. Because the synthetic respondents answered in an interview format\, their responses were longer than the humans’ and gave them more opportunities to mention alternative or related terms\. Yet they still produced fewer distinct terms\.

The table below lists all the terms used by synthetic respondents\.

Category \| All Label Responses Used by Synthetic Respondents 
\-\-\-\|\-\-\-
UX\-Related \| user experience\, user experience \(UX\)\, user experience research\, user research\, UX\, UX research 
Non\-UX Related \| customer experience\, customer insights\, data science\, market research\, product management\, service design 

How much this difference matters depends on your research goal\. If you need only the most common response\, synthetic data may be sufficient\. If you need to uncover less\-common responses — unexpected terminology\, emerging themes\, or ideas for further study — you need human participants\.

Researchers may try to counter mode collapse by prompting a model to generate more diverse answers\. However\, simply producing more variety does not mean that the variety is representative\. The model would need to generate the kinds of uncommon responses that real people give\, and at roughly the frequencies at which they occur\. Without human data for comparison\, it is difficult to know whether that variation truly reflects the population\.

\#\# Job Role Mattered\, but “UX” Was Still More Prevalent

Job role influenced terminology in the synthetic dataset\, as it did in the human dataset\. For example\, in the synthetic data\, 45\% of customer\-insights professionals used the term “customer” in their response\, compared with 0\% of the synthetic UX professionals\. Similarly\, 30\% of the synthetic market\-research professionals used “market” in their response\, compared with 0\% of the synthetic UX professionals\. These differences were statistically significant\.

However\, synthetic respondents outside UX were still more likely to use UX\-related terminology than their human counterparts\. For instance\, 93\% of product managers in the synthetic dataset used UX\-related terminology\, compared with 44\% of product managers in the human dataset\.

The synthetic data did not erase the influence of professional background\, but it pulled respondents from different roles toward the same dominant label more strongly than the human data did\. Mode collapse operated within each role as well as across the whole sample\.

This matters for researchers who want to use synthetic respondents to explore differences between audiences\. Synthetic data may still show that groups think or speak differently\, but it may understate those differences by pulling responses toward the most common framing\. In open\-ended research about how different groups naturally describe a concept\, that loss of variation could hide differences that human participants would reveal\.

\#\# Synthetic\-User Research Is Still Not User Research

Our synthetic respondents reproduced the main conclusion of the original study — UX remains the dominant term for the field — but they did not reproduce the full variation in how real people answered\. They offered fewer uncommon alternatives and showed a stronger pull toward UX terminology across roles\: mode collapse at the level of the whole sample and within each subgroup\.

Research with synthetic users is still not user research\, because no actual users are being studied\. Treat synthetic findings as a starting point rather than as evidence of what users think\, say\, or do\. A plausible finding — even one that matches human research — does not demonstrate that synthetic respondents will reliably represent the less\-common perspectives\, subgroup differences\, or natural variation that may matter to your research question\. Use synthetic respondents to generate hypotheses or check broad patterns\; when the tail of responses matters\, you need human participants\.