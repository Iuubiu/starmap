# BioDimBench: Verifying Unit-Consistent Biomedical Mathematical Reasoning

\# BioDimBench\: Verifying Unit\-Consistent Biomedical Mathematical Reasoning

Mrinal Yalageri ⋅ Aarav Sinha

\#\#\# Abstract

Scientific agents increasingly perform biomedical calculations involving dosage\, concentration\, dilution\, growth dynamics\, and measurement conversion\. In these domains\, a mathematically plausible final number may still be invalid if it is attached to an incompatible unit\. We introduce BioDimBench\, a lightweight benchmark for evaluating unit\-consistent biomedical mathematical reasoning\. The benchmark contains templated biomedical word problems with exact numeric and unit\-grounded solutions\, along with corrupted solution variants representing arithmetic\, formula\, unit\, conversion\, and plausible\-scalar wrong\-unit errors\. We formulate unit verification as dimensional type\-checking over quantities\, comparing answer\-only evaluation against unit\-only\, numeric\-plus\-unit\, step\-aware\, and learned verification baselines\. Across 500 generated biomedical problems and 3\,000 candidate solutions\, answer\-only verification achieved invalid recall 0\.600 and invalid F1 0\.750\, revealing that scalar matching accepts many dimensionally invalid solutions\. In contrast\, Numeric\+Unit and step\-aware verification achieved invalid recall 1\.000 and invalid F1 1\.000 on the controlled benchmark\, detecting every generated corruption category that answer\-only checking missed\, including all wrong\-unit and plausible\-scalar wrong\-unit cases\. These results diagnose a specific and consequential verification gap\: benchmarks that evaluate scientific AI by scalar agreement alone may systematically overestimate correctness whenever the quantity class\, not just the number\, determines validity\. We propose dimensional type\-checking as a lightweight\, training\-free verification layer for auditing biomedical calculations\.

Chat is not available\.

Successful Page Load