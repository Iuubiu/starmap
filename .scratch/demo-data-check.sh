#!/usr/bin/env bash
# 演示前「学习数据是否干净」的报告（只读，不删任何东西）。
# 用途：三档主线的首屏会出现「你已经掌握 / 掌握度已满」这类文案，
# 那是 kp-bool 上有历史作答造成的。想从零开始演，就需要知道现在有多少行。
set -euo pipefail
PSQL=${PSQL:-psql}
URL=$(grep '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//; s/^["'\'']//; s/["'\'']$//')
$PSQL "$URL" -v ON_ERROR_STOP=1 -At -F ' | ' -c "
SELECT 'attempts',            count(*) FROM app.attempts
UNION ALL SELECT 'learning_log',        count(*) FROM app.learning_log
UNION ALL SELECT 'mastery',             count(*) FROM app.mastery
UNION ALL SELECT 'node_unlocks',        count(*) FROM app.node_unlocks
UNION ALL SELECT 'gate_log',            count(*) FROM app.gate_log
UNION ALL SELECT 'kp-bool 上的作答',    count(*) FROM app.attempts WHERE micro_kp_id='kp-bool'
UNION ALL SELECT 'kp-bool 掌握度',      count(*) FROM app.mastery  WHERE micro_kp_id='kp-bool'
ORDER BY 1;
"
