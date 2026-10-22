"""t61 验收 SQL 一次性跑完（AC1/AC2/AC4/AC5/AC7 的 DB 侧证据）。"""
import sys
from pathlib import Path

sys.path.insert(0, 'apps/api')
sys.stdout.reconfigure(encoding='utf-8')

from createRequireShim import require  # noqa: E402

pg = require('pg')
URL = 'postgres://postgres:postgres@127.0.0.1:5432/starmap'


def main() -> None:
    c = pg.Client({'connectionString': URL})
    c.connect()
    q = lambda sql: c.query(sql).then  # noqa: E731
    del q

    def one(label, sql):
        r = c.query(sql)
        print(f'{label}: {r.rows[0]}')

    one('AC1 以标点开头的 name', "SELECT count(*)::int AS n FROM app.knowledge_points WHERE name ~ '^[、，。；：）)]'")
    one('AC2 作用与地位 独立条目', "SELECT count(*)::int AS n FROM app.knowledge_points WHERE name IN ('作用与地位')")
    one(
        'AC2 合并后含「作用与地位」',
        "SELECT micro_kp_id, name FROM app.knowledge_points WHERE name LIKE '%作用与地位%'",
    )
    one('AC4 chunk 无归属', 'SELECT count(*)::int AS n FROM app.chunks WHERE micro_kp_id IS NULL')
    one('AC5 推荐里短名/标点名', """
        SELECT count(*)::int AS n FROM app.knowledge_points
         WHERE is_leaf AND (name ~ '^[、，。；：）)]' OR char_length(name) < 4)
    """)
    print('--- C 类三对必须仍各自独立 ---')
    for pat in ('附录A%', '附录B%'):
        r = c.query("SELECT micro_kp_id, name FROM app.knowledge_points WHERE name LIKE $1", [pat])
        for row in r.rows:
            print(f'   {row["micro_kp_id"]}: {row["name"]}')
    for pat in ('%同轴型HPGe%', '%HPGe探测器%', '%探测器望远镜%', '%超灵敏加速器质谱仪%'):
        r = c.query("SELECT micro_kp_id, name FROM app.knowledge_points WHERE name LIKE $1", [pat])
        for row in r.rows:
            print(f'   {row["micro_kp_id"]}: {row["name"]}')
    print('--- A 类 10 个 id 现状 ---')
    ids = [
        'kp-tongshibai-5e-p598-晶体三极管模型及其参数',
        'kp-methods-1997-p28-带电粒子在靶物质中的慢化',
        'kp-methods-1997-p30-重带电粒子在物质中的能量损失',
        'kp-methods-1997-p44-重离子的电子阻止本领',
        'kp-methods-1997-p20-倍增过程统计学',
        'kp-methods-1997-p375-中子全截面测量',
        'kp-methods-1997-p325-概述',
        'kp-chenboxian-2011-13-4',
        'kp-jichangsong-1990-p472-光导纤维光导',
        'kp-jichangsong-1990-4-2-1',
    ]
    for i in ids:
        r = c.query('SELECT micro_kp_id, name FROM app.knowledge_points WHERE micro_kp_id = $1', [i])
        print(f'   {i} -> {r.rows[0]["name"] if r.rows else "MISSING"}')
    c.end()


main()
