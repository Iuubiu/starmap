import sys, psycopg
SQL = """
SELECT kp.source_id, kp.id, kp.name, kp.depth, kp.source_page,
       (SELECT count(*) FROM chunks c WHERE c.micro_kp_id = kp.id) AS n
FROM knowledge_points kp
WHERE kp.is_leaf AND kp.source_id = ANY(%s)
  AND (kp.name LIKE ANY(%s) OR kp.id = ANY(%s))
ORDER BY kp.source_id, kp.source_page, kp.id
"""
books = sys.argv[1].split(',')
terms = sys.argv[2].split(',')
pats = [f'%{t}%' for t in terms]
with psycopg.connect('postgres://postgres:postgres@127.0.0.1:5432/starmap', options='-c search_path=app,public') as conn:
    with conn.cursor() as cur:
        cur.execute(SQL, (books, pats, terms))
        for r in cur.fetchall():
            print('\t'.join(str(x) for x in r))
