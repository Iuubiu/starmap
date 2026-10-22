import sys, psycopg
# usage: cand2.py <book> <term1,term2,...>
book = sys.argv[1]
terms = sys.argv[2].split(',')
SQL = """
SELECT kp.id, kp.name, kp.depth, kp.source_page,
       (SELECT count(*) FROM chunks c WHERE c.micro_kp_id = kp.id) AS n
FROM knowledge_points kp
WHERE kp.is_leaf AND kp.source_id = %s
  AND (kp.name LIKE ANY(%s))
ORDER BY kp.source_page, kp.id
"""
pats = [f'%{t}%' for t in terms]
with psycopg.connect('postgres://postgres:postgres@127.0.0.1:5432/starmap', options='-c search_path=app,public') as conn:
    with conn.cursor() as cur:
        cur.execute(SQL, (book, pats))
        for r in cur.fetchall():
            print('\t'.join(str(x) for x in r))
