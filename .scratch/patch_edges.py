import io

p = '.scratch/probe_edges.py'
s = io.open(p, encoding='utf-8').read()
s = s.replace(
    "        if page_of[target_num] >= own_page:",
    "        if page_of.get(target_num, 10**6) >= own_page:",
)
s = s.replace(
    "        if page_of[ch] >= own_page:",
    "        if page_of.get(ch, 10**6) >= own_page:",
)
s = s.replace(
    "        if ch not in page_of:",
    "        if not ch:",
)
io.open(p, 'w', encoding='utf-8').write(s)
print('patched')
