import sys, psycopg
sql = sys.stdin.read()
with psycopg.connect('postgres://postgres:postgres@127.0.0.1:5432/starmap', options='-c search_path=app,public') as conn:
    with conn.cursor() as cur:
        cur.execute(sql)
        for row in cur.fetchall():
            print('|'.join('' if v is None else str(v) for v in row))
