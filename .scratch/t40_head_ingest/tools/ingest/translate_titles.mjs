/**
 * 把英文知识点标题译成中文（D10 红线：知识点名必须是中文）。
 *
 * 用法：
 *     node --env-file=.env tools/ingest/translate_titles.mjs \
 *         .scratch/titles.json tools/ingest/names.zh.json
 *
 * 输入：`{ "<sourceId>": ["Original English title", ...] }`
 * 输出（并入已有词条，增量）：`{ "<original>": "<中文>", ... }`
 *
 * ## 为什么是一个独立的 Node 脚本
 *
 * 凭据只能用 `process.env.LLM_API_KEY`（仓库既有做法，见
 * `tools/eval/src/layer3/llm-judge.ts`）：Python 侧读不到 `.env`（安全策略
 * 禁止直接读），也不能靠 shell 把它导出来（那等于把密钥写进命令行，会进
 * 进程表与日志）。Node 的 `--env-file` 是仓库认可的注入方式，所以翻译这一
 * 步走 Node，Python 只消费产出的 JSON。
 *
 * ## 为什么产出是一张「原文 → 中文」的词典，而不是每个书一个列表
 *
 * 15 本书里有大量重复标题（`Introduction` / `References` / `Noise` /
 * `Introduction to Radiation Measurements`…）。按原文去重后通常少三分之一
 * 的调用；更重要的是**同一原文永远得到同一个译名**，不会这本书叫「引言」、
 * 那本书叫「绪论」。
 *
 * 词典是**增量**的：已有词条直接复用，只请求新出现的标题。所以这个文件
 * 应当提交进仓库 —— 它既是缓存，也是译名的可复核来源。
 */

import fs from 'node:fs';
import process from 'node:process';

const BASE = process.env.LLM_BASE_URL ?? 'https://d1api.xin/v1';
const MODEL = process.env.LLM_MODEL ?? 'deepseek-v4.1-flash';
const KEY = process.env.LLM_API_KEY;

/** 一批多少条。40 条一次既能摊薄固定开销，又不至于让模型中途丢条目。 */
const BATCH = 40;
/** 并发请求数。网关对这个量级不敏感，串行会让 90 批变成 5 分钟。 */
const CONCURRENCY = 4;
const RETRIES = 4;

const SYSTEM = [
  '你是核电子学与辐射探测领域的中文译名专家。',
  '把用户给出的英文书籍目录标题译成简体中文。',
  '要求：',
  '1. 术语用中国大陆核电子学教材的通行译法（例如 proportional counter → 正比计数器，',
  '   preamplifier → 前置放大器，pile-up → 堆积，dead time → 死时间，',
  '   shaping → 成形，discriminator → 甄别器，multichannel analyzer → 多道分析器）。',
  '2. 不要保留英文、不要意译成解释性长句；每个译名不超过 24 个汉字。',
  '3. 保留编号前缀（`1.2` 这类）不要翻译不要删除；输入里不含编号就不加。',
  '4. 严格按输入顺序输出 JSON 数组，长度必须与输入相同。',
  '只输出 JSON：{"names": ["...", "..."]}',
].join('\n');

async function translateBatch(titles) {
  const body = JSON.stringify({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify({ titles }) },
    ],
    response_format: { type: 'json_object' },
  });

  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      const payload = await response.json();
      const text = payload.choices?.[0]?.message?.content ?? '';
      const parsed = JSON.parse(text);
      const names = parsed.names;
      if (!Array.isArray(names) || names.length !== titles.length) {
        throw new Error(`条数不匹配：要 ${titles.length} 条，回 ${Array.isArray(names) ? names.length : typeof names}`);
      }
      return names.map((name, i) => checkName(String(name ?? ''), titles[i]));
    } catch (error) {
      lastError = error;
      // 指数退避：网关偶发 429/5xx，重试比换模型便宜。
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`翻译失败（重试 ${RETRIES} 次）：${lastError?.message ?? lastError}`);
}

/**
 * 一条译名的最低要求：非空、含汉字、长度合理。
 *
 * **只有含汉字还不够**：模型偶尔会把 `References` 原样回成 `References`，
 * 那就是一个纯 ASCII 的知识点名，正是 D10 要拦的东西。含汉字是硬门槛。
 */
function checkName(name, original) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(`译名为空：${original}`);
  }
  if (!/[\u4e00-\u9fff]/.test(trimmed)) {
    throw new Error(`译名不含汉字（疑似原样返回）：${original} → ${trimmed}`);
  }
  if (trimmed.length > 40) {
    throw new Error(`译名过长（${trimmed.length} 字）：${original} → ${trimmed}`);
  }
  return trimmed;
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error('用法：node --env-file=.env tools/ingest/translate_titles.mjs <titles.json> <names.zh.json>');
  }
  if (!KEY) {
    throw new Error('LLM_API_KEY 未注入。请用 `node --env-file=.env …` 运行，或先 export。');
  }

  const perBook = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const existing = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    : {};

  const pending = [];
  const seen = new Set();
  for (const titles of Object.values(perBook)) {
    for (const title of titles) {
      if (existing[title] || seen.has(title)) continue;
      seen.add(title);
      pending.push(title);
    }
  }
  console.log(`总标题 ${Object.values(perBook).flat().length} 条，去重后待译 ${pending.length} 条（已有 ${Object.keys(existing).length} 条）`);

  let done = 0;
  const batches = [];
  for (let i = 0; i < pending.length; i += BATCH) {
    batches.push(pending.slice(i, i + BATCH));
  }

  // 每完成一批就落盘：中途失败时已花的 token 不该白花，下次能接着跑。
  const flush = () => {
    fs.writeFileSync(outputPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  };

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (cursor < batches.length) {
        const index = cursor;
        cursor += 1;
        const batch = batches[index];
        const names = await translateBatch(batch);
        batch.forEach((title, i) => {
          existing[title] = names[i];
        });
        done += batch.length;
        console.log(`  ${done}/${pending.length}`);
        flush();
      }
    }),
  );

  flush();
  console.log(`✓ 词条 ${Object.keys(existing).length} 条 → ${outputPath}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
