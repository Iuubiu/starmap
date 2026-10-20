import io
import re

p = 'tools/ingest/test_edges.py'
s = io.open(p, encoding='utf-8').read()
s = s.replace("stats['节引用:前向引用（排除）']", "stats['节引用:非后向引用（排除）']")
io.open(p, 'w', encoding='utf-8').write(s)

p2 = 'tools/ingest/run.py'
s2 = io.open(p2, encoding='utf-8').read()
s2 = s2.replace(
    "f'排除前向引用 {edge_stats.get(\"节引用:前向引用（排除）\", 0) + edge_stats.get(\"式引用:前向引用（排除）\", 0)} 处')",
    "f'排除非后向引用 {sum(v for k, v in edge_stats.items() if \"非后向引用\" in k)} 处')",
)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('done')
