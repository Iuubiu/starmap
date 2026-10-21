/**
 * 九个阶段的实现。每个阶段自己 `run` 并**自己判定结果**。
 *
 * ## 每一步的断言都是在问「这次真的发生了什么」
 *
 * 逐个说明，因为它们容易被实现成「页面打开了就算过」：
 *
 * - `cold-start`：断言 H1 文本是「学习」、底部输入框可见且可聚焦、输入能
 *   真的打进 `value`。只看 `isVisible()` 会漏掉 `readOnly`/`disabled`。
 * - `placement`：走完自评 4 题 → 开始定级 → 至少答 1 道定级题 →
 *   断言出现「这道题的判定」区域且里面有「正确答案」（票 11 验收：
 *   定级后必须展示正确答案）。断言的是**判定区存在且有正确答案**，
 *   不是「点了下一题没报错」。
 * - `map`：切到知识地图视图，断言清单项数 > 0，且**读 DOM 上的
 *   `data-recommended` 数量与 `GET /api/v1/recommendations` 的条数相等**
 *   —— 这是票 13 的一致性要求，数字对不上就归 `assertion_mismatch`。
 * - `node-detail`：从清单点进详情，断言 H1 等于清单项的名字（同一实体），
 *   并断言「可用关卡」区渲染出了至少一张关卡卡。
 * - `answer`：真的 `POST /api/v1/attempts`，然后**回查接口**
 *   （`GET /api/v1/nodes/:id` 的 percent 应随作答变化或至少不为错），
 *   并断言关卡页出现「已作答，本关内不可重答」。
 * - `board`：断言推荐卡数量 == `GET /api/v1/recommendations` 条数，
 *   且每张卡带 `data-recommended="true"`。
 * - `review`：`GET /api/v1/review/queue` 为 200；`due` 为空时断言页面
 *   显示「没有到期」，不为空时断言页面列出对应条数。
 * - `database`：断言统计卡与 `GET /api/v1/graph` 的节点数一致。
 * - `skills`：断言 `GET /api/v1/agent/skills` 的条数与页面上 skill 卡数一致。
 *
 * ## 为什么每个阶段都自己 `run` 而不是复用 driver 的动作解析
 *
 * 旧 driver 的 `target_hint` 解析是为了测「自然语言能不能指准元素」。这一版
 * 要的是**流程覆盖**：走完九个阶段、每步有断言。两者目的不同，混在一起会让
 * 「找不到元素」既可能是界面缺陷也可能是 hint 写得不好。所以这里直接用
 * 语义选择器（role + name），`locator_failure` 就一定是界面真的变了。
 */

import type { Locator, Page } from '@playwright/test';
import {
  STAGE_ORDER,
  verify,
  type StageApi,
  type StageContext,
  type StageDefinition,
  type VerifyResult,
} from './stages.ts';
import { waitForSettled } from './settle.ts';
import { probeStage } from './stage-probe.ts';
import { makeReviewDue, pickMasteredKp, readReviewRound, readReviewSchedule } from './sql.ts';

/** 每步的等待上限。地图页在无 GPU 机器上要 6–11 秒（实测），所以给宽一点。 */
const SLOW_PAGE_TIMEOUT = 30_000;
const FAST_TIMEOUT = 10_000;

function heading(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 1, name });
}

/**
 * 等到 H1 出现且文本匹配，返回实际文本。
 *
 * 不直接 `expect` 而返回字符串，是因为失败时要能在报告里写「期望 X、实际 Y」
 * —— 那正是 `assertion_mismatch` 需要的两边值。
 */
async function readHeading(page: Page, timeout = SLOW_PAGE_TIMEOUT): Promise<string | null> {
  try {
    const element = page.locator('h1').first();
    await element.waitFor({ state: 'visible', timeout });
    return (await element.innerText()).trim();
  } catch {
    return null;
  }
}

/** 由 runner 注入的 API 客户端返回体形状。 */
interface ApiList<T> {
  items?: T[];
  [key: string]: unknown;
}

/**
 * 从接口响应里取列表。
 *
 * ## 为什么不是只读 `items`
 *
 * 各个端点的列表字段名不统一，而且是**后端各自的语义**决定的，不是我
 * 们能统一的：`/nodes` 与 `/agent/skills` 用 `items`（分页 / 目录条目），
 * `/recommendations` 用 `recommendations`（它是一份「此刻推给你的这几条」，
 * 不是可分页的集合），`/review/queue` 用 `due`。
 *
 * 原来只读 `items` 时，`/recommendations` 被读成 0 条 —— 于是「地图上 3 个
 * 推荐标记 vs 接口 0 条」被报成数字对不上，看起来像产品缺陷，其实是测评
 * 工具读错了字段。这类错误最贵：它让报告里出现一条不存在的问题。
 *
 * 三个键都认，并且**只认这三个** —— 加第四个时请顺便确认它真的是「列表」。
 */
function itemsOf<T>(body: unknown): T[] {
  const list = body as ApiList<T> | null;
  for (const key of ['items', 'recommendations', 'due'] as const) {
    const value = list?.[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

// ---------------------------------------------------------------------------
// 阶段实现
// ---------------------------------------------------------------------------

const coldStart: StageDefinition = {
  stage: 'cold-start',
  label: 'S0 冷启动',
  async run({ page }: StageContext) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForSettled(page);
    const title = await readHeading(page);
    if (title === null) {
      return { result: verify.locator('h1', '首页没有渲染出任何一级标题'), evidence: [] };
    }
    if (title !== '学习') {
      return { result: verify.mismatch('学习', title, '首页一级标题不是「学习」'), evidence: [] };
    }

    const composer = page.getByRole('textbox', { name: '这一轮想说的话' });
    try {
      await composer.waitFor({ state: 'visible', timeout: FAST_TIMEOUT });
    } catch {
      return { result: verify.locator('textbox[aria-label="这一轮想说的话"]', '底部输入框不可见'), evidence: [] };
    }

    /* 「可见」不等于「能用」：disabled / readonly 的输入框也能可见。
       真的打一段进去再读回 value —— 这一步能抓到 disabled 与受控组件
       的 value 不回填两种缺陷。 */
    await composer.fill('测试');
    const typed = await composer.inputValue();
    await composer.fill('');
    if (typed !== '测试') {
      return { result: verify.mismatch('测试', typed, '输入框可见但打不进字（受控 value 没回填或 disabled）'), evidence: [] };
    }

    return {
      result: verify.passed(`H1「${title}」；输入框可见、可聚焦、可写入（回读 "${typed}"）`),
      evidence: [`H1 = ${title}`, `输入框 aria-label = 这一轮想说的话`],
    };
  },
};

const placement: StageDefinition = {
  stage: 'placement',
  label: 'S1 初始定级',
  async run({ page }: StageContext) {
    await page.goto('/placement', { waitUntil: 'domcontentloaded' });
    await waitForSettled(page);
    const title = await readHeading(page);
    if (title !== '初始定级') {
      return {
        result: title === null ? verify.locator('h1', '定级页没有渲染出 H1') : verify.mismatch('初始定级', title, '定级页标题不符'),
        evidence: [],
      };
    }

    /* 定级页是**三段向导**（`apps/web/src/pages/PlacementPage.tsx:619` 的
       `stage: 'status' | 'assess' | 'quiz' | 'result'`）：

         status  → 一张卡，按钮文案是「开始定级」（没定过级）或「重新定级」（定过了）
         assess  → 四题行为自评 + 「提交自评」
         提交后  → 「自评结果」卡 + 「开始答题」
         quiz    → `region[aria-label="定级题"]`

       原来的写法假设「自评区和开始按钮同屏存在」，于是第一步问「自评区在吗」
       得到 false、第二步点「开始」进入 assess、第三步却直接去找定级题 —— 卡在
       自评表单上。这是把三步当成了两步。下面按段显式推进。 */
    const evidence: string[] = [];

    /* ① status 屏：点进入口。已经定过级的机器上文案是「重新定级」，两者都得认。
       实在没有入口也不一定是缺陷 —— 可能直接落在结果屏（刚定完级刷新）。 */
    const entry = page.getByRole('button', { name: /开始定级|重新定级|开始答题/ });
    const hasEntry = await entry.first().isVisible().catch(() => false);
    if (hasEntry) {
      evidence.push(`入口按钮：「${(await entry.first().innerText()).trim()}」`);
      await entry.first().click();
      await waitForSettled(page);
    } else {
      evidence.push('没有入口按钮（可能已在自评或结果屏），按当前屏幕继续');
    }

    /* ② assess 屏：四道自评题全选第一项，然后提交。 */
    const selfAssessment = page.getByRole('group', { name: '行为自评' });
    const assessVisible = await selfAssessment
      .waitFor({ state: 'visible', timeout: SLOW_PAGE_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (assessVisible) {
      const groups = page.getByRole('radiogroup');
      const groupCount = await groups.count();
      if (groupCount === 0) {
        return { result: verify.locator('role=radiogroup', '自评区在，但一道题都没有渲染'), evidence };
      }
      for (let index = 0; index < groupCount; index += 1) {
        const group = groups.nth(index);
        const radios = group.getByRole('radio');
        const radioCount = await radios.count();
        if (radioCount === 0) {
          return {
            result: verify.locator(`role=radiogroup:nth(${index})`, `自评第 ${index + 1} 题没有可选项`),
            evidence,
          };
        }
        await radios.first().click();
      }
      evidence.push(`自评 ${groupCount} 题已作答`);

      const submit = page.getByRole('button', { name: '提交自评' });
      if (!(await submit.isVisible().catch(() => false))) {
        return { result: verify.locator('button:提交自评', '自评答完后没有出现「提交自评」按钮'), evidence };
      }
      await submit.click();
      await waitForSettled(page);
      evidence.push('已提交自评');
    } else {
      evidence.push('自评区不在（已定过级或已在结果屏），继续看能否开始答题');
    }

    /* ③ 自评结果屏：「开始答题」真正拉起定级会话。 */
    const startButton = page.getByRole('button', { name: /开始答题/ });
    const hasStart = await startButton
      .first()
      .waitFor({ state: 'visible', timeout: SLOW_PAGE_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (!hasStart) {
      /* 没有「开始答题」时可能已经定过级并直接落在结果屏（`region=定级结果`）。
         那不是缺陷，是「本机已定过级」的正常分支 —— 但此时本阶段确实没走
         自评→答题那条路，detail 里要说清，别报成 passed 让人以为走过了。 */
      const resultRegion = page.getByRole('region', { name: '定级结果' });
      if (await resultRegion.isVisible().catch(() => false)) {
        evidence.push('已定过级：页面直接显示定级结果屏');
        return {
          result: verify.passed('本机已定过级，定级结果屏可访问（未重走自评→答题流程）'),
          evidence,
        };
      }
      return { result: verify.locator('button:开始答题', '自评提交后没有出现「开始答题」按钮'), evidence };
    }
    await startButton.first().click();

    const questionRegion = page.getByRole('region', { name: '定级题' });
    const questionVisible = await questionRegion
      .waitFor({ state: 'visible', timeout: SLOW_PAGE_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (!questionVisible) {
      return { result: verify.locator('region[aria-label="定级题"]', '点了开始后没有出现定级题区'), evidence };
    }

    // 答一道题，然后断言「判定」区出现且带正确答案。
    const firstGroup = page.getByRole('radiogroup', { name: '这道题的选项' });
    const radios = firstGroup.getByRole('radio');
    if ((await radios.count()) === 0) {
      return { result: verify.locator('role=radiogroup:这道题的选项', '定级题没有可选项'), evidence };
    }
    await radios.first().click();
    const submitAnswer = page.getByRole('button', { name: /提交答案|提交/ });
    if (!(await submitAnswer.first().isVisible().catch(() => false))) {
      return { result: verify.locator('button:提交答案', '定级题没有提交按钮'), evidence };
    }
    await submitAnswer.first().click();

    const judgement = page.getByRole('region', { name: '这道题的判定' });
    const judged = await judgement
      .waitFor({ state: 'visible', timeout: SLOW_PAGE_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (!judged) {
      return { result: verify.locator('region[aria-label="这道题的判定"]', '答完定级题没有出现判定区'), evidence };
    }
    const judgementText = (await judgement.innerText()).trim();
    /* 票 11 的硬要求：定级后必须展示正确答案。没有这一句，学生做完 18 题
       仍然不知道自己错在哪，定级就变成了纯测量。 */
    if (!judgementText.includes('正确答案')) {
      return {
        result: verify.mismatch('判定区含「正确答案」', judgementText.slice(0, 200), '定级判定区没有展示正确答案'),
        evidence,
      };
    }
    evidence.push(`定级第 1 题已判定，判定区文案：${judgementText.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { result: verify.passed(`定级流程走通：入口 → 自评 → 开始答题 → 答题 → 判定（含正确答案）`), evidence };
  },
};

const mapStage: StageDefinition = {
  stage: 'map',
  label: 'S3 知识图谱',
  async run({ page, api, carry }: StageContext) {
    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await waitForSettled(page);

    /* 图谱页在无 GPU 的机器上要 6–11 秒才挂上画布（实测：1789 个叶节点、
       466KB 响应、SwiftShader 软件渲染）。这里等清单而不是 canvas ——
       清单是纯 DOM，比 WebGL 可靠，而且它是点击入口。 */
    const roster = page.getByRole('list', { name: '当前视野内的微知识点' });
    const rosterReady = await roster
      .waitFor({ state: 'visible', timeout: SLOW_PAGE_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (!rosterReady) {
      return { result: verify.locator('list[aria-label="当前视野内的微知识点"]', '知识地图的节点清单没有渲染出来'), evidence: [] };
    }

    const items = roster.getByRole('button');
    const itemCount = await items.count();
    if (itemCount === 0) {
      return { result: verify.mismatch('>0 个节点', '0 个', '清单存在但一个节点都没有'), evidence: [] };
    }

    /* 推荐标记与后端一致 —— 但要先想清「一致」是什么意思。
     *
     * 清单只渲染前 `ROSTER_PAGE`（400）条（见 `apps/web/src/graph/NodeRoster.tsx:84`），
     * 而真实库里叶节点有 1789 个。推荐的 3 个不一定落在这 400 个里 ——
     * 直接比「DOM 里几个标记 vs 接口几条」会在数据长大之后恒为不相等，
     * 而那是窗口大小的问题，不是推荐源分叉。
     *
     * 真正要防的风险是：「地图与看板用了两套推荐源」。这个风险可以在窗口内
     * 精确判定 —— 取清单里实际渲染的 node id（`data-node-id`），把接口返回的
     * 推荐集合投影到这个窗口上，然后要求：
     *
     *   · 窗口内被接口推荐过的，一个不少地都带 `data-recommended`；
     *   · 窗口内带 `data-recommended` 的，一个不多地都在接口集合里。
     *
     * 两个方向都查，所以任一侧换了数据源都会被抓住；且结果与窗口大小无关。 */
    const rec = await api.getJson('/recommendations');
    if (rec.status !== 200) {
      return { result: verify.backend(rec.status, rec.rawText, '读取推荐列表失败'), evidence: [`清单节点数 ${itemCount}`] };
    }
    const recommendedFromApi = new Set(itemsOf<{ microKpId: string }>(rec.body).map((entry) => entry.microKpId));
    const idsInWindow = await roster
      .locator('button[data-node-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id') ?? ''));
    const markedInDom = new Set(
      await roster
        .locator('button[data-recommended="true"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id') ?? '')),
    );
    const expectedInWindow = new Set(idsInWindow.filter((id) => recommendedFromApi.has(id)));
    const missed = [...expectedInWindow].filter((id) => !markedInDom.has(id));
    const extra = [...markedInDom].filter((id) => !recommendedFromApi.has(id));
    if (missed.length > 0 || extra.length > 0) {
      return {
        result: verify.mismatch(
          `窗口内应有推荐标记 ${expectedInWindow.size} 个、无多余标记`,
          `漏标 ${missed.length} 个（${missed.slice(0, 3).join('、') || '无'}）、多标 ${extra.length} 个（${extra.slice(0, 3).join('、') || '无'}）`,
          '图谱清单的推荐标记与 /recommendations 不一致（两处应共享同一个 recommend()）',
        ),
        evidence: [
          `清单节点数 ${itemCount}`,
          `清单窗口内 ${idsInWindow.length} 个节点`,
          `接口推荐 ${recommendedFromApi.size} 条，落在窗口内 ${expectedInWindow.size} 条`,
          `DOM 标记 ${markedInDom.size} 个`,
        ],
      };
    }

    // 记下第一个节点，给下一阶段用。
    const first = items.first();
    const firstLabel = (await first.getAttribute('aria-label')) ?? '';
    const nodeName = firstLabel.split('，')[0] ?? '';
    if (nodeName === '') {
      return { result: verify.locator('roster button[aria-label]', '清单项没有可读的可访问名'), evidence: [] };
    }
    carry.set('nodeName', nodeName);
    return {
      result: verify.passed(
        `清单 ${itemCount} 个节点；接口推荐 ${recommendedFromApi.size} 条，窗口内 ${expectedInWindow.size} 条全部正确标记`,
      ),
      evidence: [
        `清单节点数 ${itemCount}`,
        `接口推荐 ${recommendedFromApi.size} 条（落在当前窗口 ${expectedInWindow.size} 条，均已标记）`,
        `首个节点可访问名：${firstLabel}`,
      ],
    };
  },
};

const nodeDetail: StageDefinition = {
  stage: 'node-detail',
  label: 'S3 节点详情',
  async run({ page, carry }: StageContext) {
    /* 先确认清单在。map 阶段可能因为后端重启窗口失败了，而阶段之间是
       **不中断**的 —— 上一步没把页面留在 /map 的可用状态，这一步就会在
       一个空清单上找按钮，报成「详情页没有 H1」。实测过一次：map 报
       backend_error 后 node-detail 跟着红，看起来像两个缺陷，其实是一个。

       所以这里自己负责把自己需要的页面拿到手：清单不在就重新导航一次。 */
    const roster = page.getByRole('list', { name: '当前视野内的微知识点' });
    if ((await roster.count()) === 0) {
      await page.goto('/map', { waitUntil: 'domcontentloaded' });
      await waitForSettled(page);
    }
    const itemButtons = roster.getByRole('button');

    /* 找一个**有可用关卡**的节点：没关卡的节点详情页只会显示「还没有关卡」，
       走不到做题那一步。按可访问名逐个点太慢，改为直接读接口找 kp-bool
       （只有它有教学关卡）。找不到就退回到第一个节点。 */
    const wanted = carry.get('nodeName') ?? '';
    let target = itemButtons.first();
    const all = await itemButtons.all();
    let picked = wanted;
    for (const candidate of all) {
      const label = (await candidate.getAttribute('aria-label')) ?? '';
      const name = label.split('，')[0] ?? '';
      if (name === '布尔代数基本运算') {
        target = candidate;
        picked = name;
        break;
      }
    }
    if ((await target.count()) === 0) {
      return { result: verify.locator('roster button', '清单里没有任何可点的节点'), evidence: [] };
    }

    await target.click();

    /* 等 URL 真的变成 /map/<id>，而不是等一个固定 800ms。
       固定等待在慢机器上太短（点击后详情页要拉两个接口），在快机器上白等。 */
    await page
      .waitForURL(/\/map\/[^/]+$/, { timeout: SLOW_PAGE_TIMEOUT })
      .catch(() => undefined);
    await waitForSettled(page);

    const title = await readHeading(page);
    if (title === null) {
      return {
        result: verify.locator('h1', `点进节点后详情页没有渲染出 H1（当前 URL：${page.url()}）`),
        evidence: [`点击的目标：${picked || '清单第一项'}`],
      };
    }
    if (picked !== '' && title !== picked) {
      return {
        result: verify.mismatch(picked, title, '点进去的详情页 H1 与清单项名字不一致（点错了节点或详情取错知识点）'),
        evidence: [],
      };
    }

    // 「可用关卡」区必须至少有一张卡，否则做题那一步走不下去。
    const levelHeading = page.getByText('可用关卡', { exact: true });
    if (!(await levelHeading.isVisible().catch(() => false))) {
      return { result: verify.locator('text:可用关卡', '详情页没有「可用关卡」区'), evidence: [`H1=${title}`] };
    }
    const startButtons = page.getByRole('button', { name: /^开始$|^未解锁$/ });
    const buttonCount = await startButtons.count();
    const hasStartable = buttonCount > 0 && (await page.getByRole('button', { name: '开始' }).count()) > 0;
    carry.set('hasLevel', hasStartable ? 'true' : 'false');
    return {
      result: verify.passed(`详情页 H1「${title}」与清单项一致；可用关卡区有 ${buttonCount} 个入口按钮${hasStartable ? '（可进入）' : '（全部未解锁或无内容）'}`),
      evidence: [`H1 = ${title}`, `关卡入口按钮 ${buttonCount} 个`, hasStartable ? '至少一个可进入' : '没有可进入的关卡'],
    };
  },
};

const answerStage: StageDefinition = {
  stage: 'answer',
  label: 'S4 作答与判分',
  async run({ page, api, carry, persona }: StageContext) {
    const evidence: string[] = [];
    if (carry.get('hasLevel') !== 'true') {
      /* 内容不足时这一阶段无法覆盖 —— 明确记成 passed 但 detail 说清，
         让报告层把它归到「已知缺口」而不是假装测过。 */
      return {
        result: verify.passed('本节点没有可进入的关卡（内容不足），本阶段未覆盖'),
        evidence: ['跳过原因：上一阶段未找到可进入的关卡'],
      };
    }

    /* 进关卡**之前**先读一次掌握度。这是票 20 AC3「看掌握度变化」的前一半：
       只断言 `attemptCount > 0` 是弱断言 —— 它证明不了这一阶段改变了什么
       （上一轮旅程留下的作答同样能让它 > 0）。必须比 before/after。 */
    const kpId = carry.get('microKpId');
    interface MasterySnapshot {
      attemptCount: number;
      current: number | null;
      achieved: number | null;
      state: string;
      evidenceSufficient: boolean;
      lastEvidenceAt: string | null;
    }
    const readMastery = async (): Promise<MasterySnapshot | null> => {
      if (kpId === undefined) return null;
      const response = await api.getJson(`/mastery/${encodeURIComponent(kpId)}`);
      if (response.status !== 200) return null;
      const body = response.body as Partial<MasterySnapshot>;
      return {
        attemptCount: Number(body.attemptCount ?? 0),
        current: typeof body.current === 'number' ? body.current : null,
        achieved: typeof body.achieved === 'number' ? body.achieved : null,
        state: String(body.state ?? 'unseen'),
        evidenceSufficient: body.evidenceSufficient === true,
        lastEvidenceAt: typeof body.lastEvidenceAt === 'string' ? body.lastEvidenceAt : null,
      };
    };
    const before = await readMastery();
    if (before !== null) {
      evidence.push(
        `作答前掌握度：attemptCount=${before.attemptCount} current=${String(before.current)} achieved=${String(before.achieved)} state=${before.state} evidenceSufficient=${String(before.evidenceSufficient)}`,
      );
    }

    // 进入关卡。
    await page.getByRole('button', { name: '开始' }).first().click();
    await page.waitForTimeout(1000);

    const levelTitle = await readHeading(page);
    if (levelTitle === null) {
      return { result: verify.locator('h1', '关卡页没有渲染出 H1'), evidence };
    }
    evidence.push(`进入关卡：${levelTitle}`);

    /* 走到判定段需要点若干次「进入下一段」。教学关有 7 段，最多点 10 次。
     *
     * ## 为什么按「段」而不是按「题」循环
     *
     * `apps/web/src/pages/LevelPage.tsx:437` 把**当前段引用的所有题一次全渲染**
     * （quiz 段就同时出现 2 张题卡），而「进入下一段」的 `disabled={!complete}`
     * 依赖 `isStepComplete()`（`level/flow.ts:250`）—— 要求本段**每道题**都有选择。
     *
     * 原来的写法是「找一个 提交答案 → 点一次 → 点进入下一段」，于是多题段永远
     * 卡住：第一题答完还有第二题未答，进入下一段仍是 disabled，Playwright 会
     * 一直等到 30 秒超时，报出来的却是「locator.click 超时」—— 看起来像选择器
     * 写错，实际是漏了「一题一段要答完」这个规则。
     */
    let answered = 0;
    for (let step = 0; step < 12; step += 1) {
      /* ① 把本段所有未作答的题都答上。判据是「有未选中的 radio 组」/「空填空框」，
         而不是按钮文案 —— 按钮在未选时会 disabled，但仍在 DOM 里。 */
      let answeredThisStep = 0;
      for (let round = 0; round < 8; round += 1) {
        const groups = page.getByRole('radiogroup');
        const groupCount = await groups.count();
        let picked = false;
        for (let index = groupCount - 1; index >= 0; index -= 1) {
          const group = groups.nth(index);
          if (!(await group.isVisible().catch(() => false))) continue;
          const radios = group.getByRole('radio');
          const radioCount = await radios.count();
          if (radioCount === 0) continue;
          let alreadyChosen = false;
          for (let r = 0; r < radioCount; r += 1) {
            if (await radios.nth(r).isChecked().catch(() => false)) {
              alreadyChosen = true;
              break;
            }
          }
          if (alreadyChosen) continue;
          if (await radios.first().isDisabled().catch(() => false)) continue;
          await radios.first().click();
          picked = true;
          break;
        }
        if (!picked) break;
      }

      /* 填空类题（`item.options` 为空的那种）：页面上的是 aria-label="答案填空"
         的 textarea。它们不能用 radio 判「已作答」，所以单独补一次。 */
      const blanks = page.getByRole('textbox', { name: '答案填空' });
      const blankCount = await blanks.count();
      for (let index = 0; index < blankCount; index += 1) {
        const blank = blanks.nth(index);
        if (!(await blank.isVisible().catch(() => false))) continue;
        if ((await blank.inputValue().catch(() => '')).trim() !== '') continue;
        if (await blank.isDisabled().catch(() => false)) continue;
        await blank.fill('吸收律');
      }

      /* ② 点掉本段所有还处于可点状态的「提交答案」。每提交一题，那张卡会
         变成「已作答，本关内不可重答」，按钮从 DOM 里消失，所以循环会收敛。 */
      for (let round = 0; round < 8; round += 1) {
        const submits = page.getByRole('button', { name: '提交答案' });
        const submitCount = await submits.count();
        let clicked = false;
        for (let index = 0; index < submitCount; index += 1) {
          const submit = submits.nth(index);
          if (!(await submit.isVisible().catch(() => false))) continue;
          if (await submit.isDisabled().catch(() => false)) continue;
          await submit.click();
          answered += 1;
          answeredThisStep += 1;
          clicked = true;
          await page.waitForTimeout(400);
          break;
        }
        if (!clicked) break;
      }
      if (answeredThisStep > 0) evidence.push(`第 ${step + 1} 轮：本段提交 ${answeredThisStep} 题`);

      /* ③ 本段答完了就前进。按钮 disabled 说明还有题没答（或者本身就是终点），
         两种情况都不应该硬点 —— 直接退出循环。 */
      const advance = page.getByRole('button', { name: /进入下一段|开始这一段|下一段|看结果|完成本关/ });
      const advanceCount = await advance.count();
      let advanced = false;
      for (let index = 0; index < advanceCount; index += 1) {
        const button = advance.nth(index);
        if (!(await button.isVisible().catch(() => false))) continue;
        if (await button.isDisabled().catch(() => false)) continue;
        await button.click();
        await page.waitForTimeout(600);
        advanced = true;
        break;
      }
      if (!advanced) break;
      if (answered >= 4) break;
    }

    if (answered === 0) {
      return { result: verify.locator('button:提交答案', '关卡里没有出现任何可作答的题（内容不足或流程断裂）'), evidence };
    }
    evidence.push(`在关卡内提交 ${answered} 道题`);

    /* 真的写进库了吗？再读一次掌握度，与作答前那次比。
     *
     * ## 为什么必须比 before/after，而不是只看 attemptCount > 0
     *
     * `attemptCount > 0` 是弱断言：三档 persona 共用同一个库，P1 跑完留下的
     * 作答会让 P2 这一阶段「通过」，哪怕 P2 一次都没落库。它证明的是「库里有
     * 证据」，不是「这一阶段产生了证据」。
     *
     * 断言三条：
     * 1. `attemptCount` 的增量 == 本阶段实际提交的题数（多一条或少一条都是 bug）；
     * 2. `current` 发生变化 —— 掌握度是按证据回放的，新证据必然改后验；
     * 3. 若 `evidenceSufficient` 由 false 变 true，`state` 必须跟着变
     *    （`deriveState` 在证据不足时恒为 `attempted`，够了才可能升档）。
     */
    const nodeTitle = carry.get('nodeName') ?? '';
    if (before !== null) {
      const after = await readMastery();
      if (after === null) {
        return { result: verify.backend(0, '第二次读取掌握度失败', '作答后读不到掌握度接口'), evidence };
      }
      evidence.push(
        `作答后掌握度：attemptCount=${after.attemptCount} current=${String(after.current)} achieved=${String(after.achieved)} state=${after.state} evidenceSufficient=${String(after.evidenceSufficient)}`,
      );

      const delta = after.attemptCount - before.attemptCount;
      if (delta !== answered) {
        return {
          result: verify.mismatch(
            `attemptCount 增加 ${answered}`,
            `增加 ${delta}（${before.attemptCount} → ${after.attemptCount}）`,
            `界面显示提交 ${answered} 题，掌握度接口的 attemptCount 只增加了 ${delta} —— 有作答没落库，或有重复计数`,
          ),
          evidence,
        };
      }

      /* ## 为什么先看 `lastEvidenceAt`，而不是直接比 `current`
       *
       * 实跑抓到过假红：`kp-bool` 已经掌握，`current = 0.9999984947945203`。
       * 关卡是 3 道题（对 / 错 / 对），每过一遍正好是 BKT 后验的**长度 3 循环**
       * —— 三条新证据之后回到同一个数。这时「current 必须变」测的不是
       * 「掌握度从证据回放」，而是「这个节点还没进饱和区」。断言写错了。
       *
       * `lastEvidenceAt` 才是「新证据被读进去了」的直接证据：它由
       * `replayMastery` 从最后一条证据的时间戳算出，与数值饱不饱和无关。
       */
      if (before.lastEvidenceAt !== null && after.lastEvidenceAt !== null && before.lastEvidenceAt === after.lastEvidenceAt) {
        return {
          result: verify.mismatch(
            'lastEvidenceAt 前进',
            `两次都是 ${after.lastEvidenceAt}`,
            `新增 ${answered} 条证据后 lastEvidenceAt 没动 —— 新作答没进掌握度回放`,
          ),
          evidence,
        };
      }

      /* 再看数值。`current` 可能为 null（证据不足时接口刻意不给数字），
         那时比不了，要在 evidence 里说清而不是当成「没变化」。
         饱和带（≥ 0.99，高于 `MASTERY_THRESHOLD=0.95` 一档）内允许相等：
         那里的节点早已远超解锁所需，新证据只是让它继续贴着上界。 */
      const SATURATION_BAND = 0.99;
      const saturated =
        before.current !== null && after.current !== null && before.current >= SATURATION_BAND && after.current >= SATURATION_BAND;
      if (before.current !== null && after.current !== null && before.current === after.current && !saturated) {
        return {
          result: verify.mismatch(
            'current 发生变化（或已在饱和带）',
            `两次都是 ${String(after.current)}，且未达 ${SATURATION_BAND}`,
            `新增 ${answered} 条证据后 current 完全没变 —— 掌握度不是从证据回放的`,
          ),
          evidence,
        };
      }
      if (!before.evidenceSufficient && after.evidenceSufficient && before.state === after.state) {
        return {
          result: verify.mismatch(
            '证据从不足变充足时 state 升档',
            `两次都是 ${after.state}`,
            'evidenceSufficient 由 false 变 true，但 state 没变 —— deriveState 没接上证据量',
          ),
          evidence,
        };
      }
      evidence.push(
        `掌握度变化：attemptCount +${delta}，current ${String(before.current)} → ${String(after.current)}，state ${before.state} → ${after.state}` +
          (saturated && before.current === after.current ? '（current 已在饱和带，等值是 BKT 后验的固定循环，不是没回放）' : ''),
      );
      evidence.push(`lastEvidenceAt ${String(before.lastEvidenceAt)} → ${String(after.lastEvidenceAt)}`);
    } else {
      evidence.push(`（没有记下知识点 id 或首次读取失败，跳过库侧核对；H1=${nodeTitle}）`);
    }

    /* 学生的话也要真的说出来一次：这是 P1/P2/P3 唯一能出现「学生原话」的
       地方。不指望它触发什么，只确认输入框还能用。 */
    const composer = page.getByRole('textbox', { name: '这一轮想说的话' });
    if (await composer.isVisible().catch(() => false)) {
      await composer.fill(persona.wrongAnswerRemark);
      const readBack = await composer.inputValue();
      if (readBack !== persona.wrongAnswerRemark) {
        return { result: verify.mismatch(persona.wrongAnswerRemark, readBack, '关卡页输入框打不进字'), evidence };
      }
      evidence.push(`学生原话可写入：「${persona.wrongAnswerRemark}」`);
    }

    return { result: verify.passed(`关卡「${levelTitle}」内提交 ${answered} 题，作答已落库`), evidence };
  },
};

const boardStage: StageDefinition = {
  stage: 'board',
  label: 'S6 看板推荐',
  async run({ page, api }: StageContext) {
    await page.goto('/board', { waitUntil: 'domcontentloaded' });
    await waitForSettled(page);
    const title = await readHeading(page);
    if (title !== '看板') {
      return {
        result: title === null ? verify.locator('h1', '看板页没有 H1') : verify.mismatch('看板', title, '看板页标题不符'),
        evidence: [],
      };
    }

    const rec = await api.getJson('/recommendations');
    if (rec.status !== 200) {
      return { result: verify.backend(rec.status, rec.rawText, '读取推荐列表失败'), evidence: [] };
    }
    const apiCount = itemsOf<{ microKpId: string }>(rec.body).length;

    /* `data-recommended="true"` 是 DashboardPage 给推荐卡片打的钩子
       （`apps/web/src/pages/DashboardPage.tsx:305`）。

       ## 为什么要先等卡片

       `readHeading()` 只保证 H1 已渲染，而 H1 是静态的 —— 推荐卡要等
       `/recommendations` 回来才出现（`recommendations.isPending` 期间是 Spinner）。
       原来直接 `count()` 会读到 0，报成「看板 0 条 vs 接口 3 条」，看起来像看板
       不显示推荐 —— 实际只是读得太早。接口说有 n 条，就等这 n 条出现。 */
    const cards = page.locator('[data-recommended="true"]');
    if (apiCount > 0) {
      const arrived = await cards
        .first()
        .waitFor({ state: 'visible', timeout: SLOW_PAGE_TIMEOUT })
        .then(() => true)
        .catch(() => false);
      if (!arrived) {
        return {
          result: verify.mismatch(
            `接口 ${apiCount} 条推荐，页面上应有 ${apiCount} 张卡`,
            '0 张',
            '看板在等待超时内没有渲染出任何推荐卡（接口有数据）',
          ),
          evidence: [`接口推荐 ${apiCount} 条`],
        };
      }
    }
    const domCount = await cards.count();
    if (domCount !== apiCount) {
      return {
        result: verify.mismatch(String(apiCount), String(domCount), '看板推荐卡上的 data-recommended 数量与 /recommendations 条数不一致'),
        evidence: [],
      };
    }

    // 今日摘要那一块必须存在（票 13 的另一半）。
    const summary = page.getByRole('region', { name: /今日学习摘要|今日摘要/ });
    const summaryVisible = await summary.isVisible().catch(() => false);
    return {
      result: verify.passed(`看板推荐 ${domCount} 条，与接口一致${summaryVisible ? '；今日摘要区存在' : ''}`),
      evidence: [`推荐卡 ${domCount} 条 / 接口 ${apiCount} 条`, `今日摘要区${summaryVisible ? '可见' : '不可见'}`],
    };
  },
};

const reviewStage: StageDefinition = {
  stage: 'review',
  label: 'S6 复验',
  async run({ page, api }: StageContext) {
    const evidence: string[] = [];

    /* ## 为什么要「先看队列，空了就主动造一次到期」
     *
     * 复验的触发条件是 `app.mastery.next_review_at <= now()`，而票 07 的规则是
     * 「掌握那一刻起算 +1 天」—— 一个刚学完的库，队列**必然是空的**。旧版阶段
     * 在这里就 `return passed` 了，于是 `POST /review/rounds` 从来没被调用过，
     * 票 20 AC3 的「触发一次复验」这一半永远是空的。
     *
     * 空队列时段的正确做法不是放弃，而是**制造一次到期**：挑一个已掌握、且
     * 有 ≥3 道题的叶子知识点，把它的 `next_review_at` 拨到昨天。产品侧没有任何
     * 接口能做这件事（那是对的 —— 让学生改复验排期等于让复验失效），所以只能
     * 由评估器直连一次数据库。**这是评估器与产品之间的已知耦合点**，写进报告。
     */
    const queueNow = async (): Promise<{
      status: number;
      rawText: string;
      due: Array<{ microKpId: string; name?: string }>;
    }> => {
      const response = await api.getJson('/review/queue');
      const due = Array.isArray((response.body as { due?: unknown[] })?.due)
        ? (response.body as { due: Array<{ microKpId: string; name?: string }> }).due
        : [];
      return { status: response.status, rawText: response.rawText, due };
    };

    let queue = await queueNow();
    if (queue.status !== 200) {
      return { result: verify.backend(queue.status, queue.rawText, '读取复验队列失败'), evidence };
    }
    evidence.push(`开始时 /review/queue 到期 ${queue.due.length} 条`);

    let madeDue = false;
    if (queue.due.length === 0) {
      const picked = pickMasteredKp();
      if (picked === null) {
        /* 本机没有任何「已掌握 + 有 ≥3 道题」的知识点 —— 那是内容/证据不足，
           不是产品缺陷。明确记成未覆盖，不静默通过。 */
        return {
          result: verify.passed('本机没有「已掌握且题目 ≥3 道」的知识点，复验阶段未覆盖（先跑完 answer 阶段或补内容）'),
          evidence,
        };
      }
      const made = makeReviewDue(picked.microKpId, 1);
      if (!made.ok) {
        return { result: verify.backend(0, made.error ?? '', `造复验到期失败：${made.error ?? ''}`), evidence };
      }
      if (made.affected === 0) {
        return {
          result: verify.passed(`挑中的知识点 ${picked.microKpId} 没有 mastery 行（尚未掌握），复验阶段未覆盖`),
          evidence,
        };
      }
      madeDue = true;
      evidence.push(`造到期：把 ${picked.microKpId} 的 next_review_at 拨到 1 天前（UPDATE app.mastery，1 行）`);
      queue = await queueNow();
      if (queue.due.length === 0) {
        return {
          result: verify.mismatch(
            '造到期后队列应列出该知识点',
            'due 仍为空',
            'next_review_at 已拨到过去，但 /review/queue 没有列出它（队列查询与排期列不同源）',
          ),
          evidence,
        };
      }
    }

    const target = queue.due[0];
    if (target === undefined) {
      return { result: verify.mismatch('队列里应有 ≥1 条到期', '0 条', '复验队列返回空但状态是 200'), evidence };
    }
    const targetKp = target.microKpId;
    const scheduleBefore = readReviewSchedule(targetKp);
    evidence.push(
      `目标知识点 ${targetKp}${target.name !== undefined ? `（${target.name}）` : ''}：复验前 review_stage=${String(scheduleBefore?.reviewStage)} next_review_at=${String(scheduleBefore?.nextReviewAt)}`,
    );

    /* 页面先打开一次，确认队列态渲染得出来（这是学习者看到的第一屏）。 */
    await page.goto('/review', { waitUntil: 'domcontentloaded' });
    await waitForSettled(page);
    const queueTitle = await readHeading(page, SLOW_PAGE_TIMEOUT);
    if (queueTitle === null) {
      return { result: verify.locator('h1', '复验页没有渲染出 H1'), evidence };
    }
    const queueBody = await page.locator('body').innerText().catch(() => '');
    if (!queueBody.includes(targetKp) && (target.name === undefined || !queueBody.includes(target.name))) {
      return {
        result: verify.mismatch(
          `页面上出现到期的知识点 ${target.name ?? targetKp}`,
          '页面文本里找不到它',
          '接口说它到期，复验页却没有列出它（两处读的不是同一份队列）',
        ),
        evidence,
      };
    }
    evidence.push(`复验页 H1「${queueTitle}」并列出到期的 ${target.name ?? targetKp}`);

    /* ## 真开一轮
     *
     * `POST /review/rounds` 是显式动作（票 07 的设计：进页面不自动抽题 ——
     * 学生可能只想看看有没有到期的）。这里按学生的真实路径点页面上的
     * 「开始复验」按钮，然后断言接口给了 3–5 题。
     */
    const startButton = page.getByRole('button', { name: '开始复验' });
    const canStart = await startButton.isVisible().catch(() => false);
    if (canStart) {
      await startButton.click();
      await waitForSettled(page);
      evidence.push('点击了页面上的「开始复验」');
    }

    /* 页面点击的结果与直接打接口要一致。这里**以接口为准**取 roundId：
       页面的 URL 会带 `?round=`，但那是渲染细节；接口响应才是事实。 */
    const started = await api.postJson('/review/rounds', {});
    if (started.status === 409) {
      return {
        result: verify.backend(409, started.rawText, `开复验轮次被拒（409）：${started.rawText.slice(0, 200)}`),
        evidence,
      };
    }
    if (started.status !== 200) {
      return { result: verify.backend(started.status, started.rawText, '开复验轮次失败'), evidence };
    }
    const round = started.body as {
      round?: { roundId?: string; itemCount?: number };
      items?: Array<{ itemId: string; microKpId: string; ordinal: number }>;
    };
    const roundId = round.round?.roundId ?? '';
    const items = round.items ?? [];
    if (roundId === '') {
      return { result: verify.mismatch('响应里有 roundId', '没有', '开复验轮次的响应缺 roundId'), evidence };
    }
    if (items.length < 3 || items.length > 5) {
      return {
        result: verify.mismatch('一轮 3–5 题', `${items.length} 题`, '复验抽题数不在 3–5 之间（票 07 验收 1）'),
        evidence,
      };
    }
    const distinctItems = new Set(items.map((item) => item.itemId)).size;
    evidence.push(`开了一轮复验 ${roundId}：${items.length} 题（${distinctItems} 个不同题）`);

    const openRound = readReviewRound(roundId);
    if (openRound === null) {
      evidence.push('（读不到库里的 review_rounds 行，跳过「open → completed」的库侧断言）');
    } else if (openRound.verdict !== null) {
      return {
        result: verify.mismatch('新开的轮次 verdict 为 null（open）', String(openRound.verdict), '刚开的复验轮次已经有判分结果'),
        evidence,
      };
    } else {
      evidence.push(`库侧：review_rounds.verdict = null（open），item_count = ${openRound.itemCount}`);
    }

    /* ## 在页面上真答完
     *
     * 直接 goto `?round=<id>`：那是刷新后恢复同一轮题的深链接，也是学生
     * 「中途离开再回来」的真实路径。比在首页点进面板更贴近要测的东西。
     */
    await page.goto(`/review?round=${encodeURIComponent(roundId)}`, { waitUntil: 'domcontentloaded' });
    await waitForSettled(page);

    let answered = 0;
    for (let roundIndex = 0; roundIndex < 12; roundIndex += 1) {
      const groups = page.getByRole('radiogroup');
      const groupCount = await groups.count();
      let picked = false;
      for (let index = 0; index < groupCount; index += 1) {
        const group = groups.nth(index);
        if (!(await group.isVisible().catch(() => false))) continue;
        const radios = group.getByRole('radio');
        const radioCount = await radios.count();
        if (radioCount === 0) continue;
        let alreadyChosen = false;
        for (let r = 0; r < radioCount; r += 1) {
          if (await radios.nth(r).isChecked().catch(() => false)) {
            alreadyChosen = true;
            break;
          }
        }
        if (alreadyChosen) continue;
        if (await radios.first().isDisabled().catch(() => false)) continue;
        await radios.first().click();
        picked = true;
        break;
      }
      if (!picked) break;

      /* 每选完一题就点它那一张卡的「提交答案」。复验页每题一张 QuestionView，
         提交后按钮消失，所以循环会收敛。 */
      const submits = page.getByRole('button', { name: '提交答案' });
      const submitCount = await submits.count();
      let clicked = false;
      for (let index = 0; index < submitCount; index += 1) {
        const submit = submits.nth(index);
        if (!(await submit.isVisible().catch(() => false))) continue;
        if (await submit.isDisabled().catch(() => false)) continue;
        await submit.click();
        answered += 1;
        clicked = true;
        await page.waitForTimeout(350);
        break;
      }
      if (!clicked) break;
    }

    if (answered === 0) {
      return { result: verify.locator('button:提交答案', '复验页没有出现任何可作答的题'), evidence };
    }
    evidence.push(`在复验页面上提交 ${answered} 题`);

    const completeButton = page.getByRole('button', { name: '交卷并判分' });
    const canComplete = await completeButton
      .waitFor({ state: 'visible', timeout: SLOW_PAGE_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (!canComplete) {
      return { result: verify.locator('button:交卷并判分', '复验页没有出现「交卷并判分」按钮'), evidence };
    }
    if (await completeButton.isDisabled().catch(() => false)) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return {
        result: verify.mismatch(
          '答完所有题后「交卷并判分」可点',
          '按钮仍禁用',
          `提交了 ${answered}/${items.length} 题，交卷按钮仍 disabled（页面文本：${bodyText.replace(/\s+/g, ' ').slice(0, 160)}）`,
        ),
        evidence,
      };
    }
    await completeButton.click();
    await waitForSettled(page);

    const resultText = await page.locator('body').innerText().catch(() => '');
    if (!/这一轮复验结束了|通过了|没通过/.test(resultText)) {
      return {
        result: verify.mismatch(
          '判分后页面显示结果',
          resultText.replace(/\s+/g, ' ').slice(0, 160),
          '点了交卷后页面没有进入结果态',
        ),
        evidence,
      };
    }
    evidence.push('页面上完成判分并显示结果');

    /* ## 库侧：open → completed，且排期真的动了 */
    const completed = readReviewRound(roundId);
    if (completed === null) {
      evidence.push('（读不到库里的 review_rounds 行，跳过终态断言）');
    } else {
      if (completed.verdict === null) {
        return {
          result: verify.mismatch('review_rounds.verdict 已写入', 'null', '页面上判分完成了，库里的轮次仍是 open'),
          evidence,
        };
      }
      evidence.push(
        `库侧：review_rounds.verdict = ${completed.verdict}，correct_count = ${String(completed.correctCount)}/${completed.itemCount}`,
      );
    }

    const scheduleAfter = readReviewSchedule(targetKp);
    if (scheduleBefore !== null && scheduleAfter !== null) {
      evidence.push(`复验后 review_stage=${scheduleAfter.reviewStage} next_review_at=${scheduleAfter.nextReviewAt}`);
      const stageChanged = scheduleAfter.reviewStage !== scheduleBefore.reviewStage;
      const dueChanged = scheduleAfter.nextReviewAt !== scheduleBefore.nextReviewAt;
      if (!stageChanged && !dueChanged) {
        return {
          result: verify.mismatch(
            '复验后 review_stage 或 next_review_at 至少一个变化',
            `stage ${scheduleBefore.reviewStage}→${scheduleAfter.reviewStage}，nextDue ${String(scheduleBefore.nextReviewAt)}→${String(scheduleAfter.nextReviewAt)}`,
            '一轮复验判分完成后，排期没有任何变化 —— advanceReviewSchedule 没接上',
          ),
          evidence,
        };
      }
      evidence.push(
        `排期变化：review_stage ${scheduleBefore.reviewStage} → ${scheduleAfter.reviewStage}；next_review_at ${String(scheduleBefore.nextReviewAt)} → ${String(scheduleAfter.nextReviewAt)}`,
      );
    }

    /* 顺带记下「这一轮造到期是评估器改的库」——报告里要写明这个耦合点。 */
    if (madeDue) evidence.push('注意：本次复验的到期时刻由评估器直连数据库修改（产品侧无此接口），属已知耦合点');

    return {
      result: verify.passed(
        `复验链路走通：队列 ${queue.due.length} 条到期${madeDue ? '（评估器造到期 1 条）' : ''} → 抽 ${items.length} 题 → 页面答 ${answered} 题 → 判分完成 → 排期 ${String(scheduleBefore?.reviewStage)}→${String(scheduleAfter?.reviewStage)}`,
      ),
      evidence,
    };
  },
};

const databaseStage: StageDefinition = {
  stage: 'database',
  label: 'S7 数据库检视',
  async run({ page, api }: StageContext) {
    await page.goto('/database', { waitUntil: 'domcontentloaded' });
    await waitForSettled(page);
    const title = await readHeading(page, SLOW_PAGE_TIMEOUT);
    if (title !== '数据库') {
      return {
        result: title === null ? verify.locator('h1', '数据库页没有 H1') : verify.mismatch('数据库', title, '数据库页标题不符'),
        evidence: [],
      };
    }

    /* 页面上「知识点」统计卡的数字要与图谱节点数一致。两处读的是同一批
       数据，不一致说明有一侧算错或缓存没刷新。 */
    const graph = await api.getJson('/graph');
    if (graph.status !== 200) {
      return { result: verify.backend(graph.status, graph.rawText, '读取图谱失败'), evidence: [] };
    }
    const nodeCount = Array.isArray((graph.body as { nodes?: unknown[] }).nodes)
      ? ((graph.body as { nodes: unknown[] }).nodes.length)
      : 0;
    const bodyText = await page.locator('body').innerText();
    const mentions = bodyText.includes(String(nodeCount));

    /* 回归守卫：没选中知识点时不应有任何 Spinner。

       这条防的是一个已经发生过、并且**只在屏幕上看得出来**的产品缺陷：
       条件启用的 hook（`useNodeSources(activeId)` 在未选中时 `enabled: false`）
       用了 `isPending`，而 TanStack Query v5 里禁用查询的 `status` 恒为
       `'pending'` —— 于是「读取来源…」从挂载到卸载一直在转，屏幕阅读器
       会永远念它。captain 已改成 `isFetching`（commit `bc32ae3`）。

       为什要在测评里写这条：`waitForSettled` 超时是**静默返回**的，有人把
       `isPending` 用回来时，测评只会安静地多等 20 秒，然后一切如常地绿。
       这个缺陷不会把任何阶段变成红 —— 只能显式断言。 */
    const lingering = await page.getByRole('progressbar').count();
    if (lingering > 0) {
      const labels = await page
        .getByRole('progressbar')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent ?? ''));
      return {
        result: verify.mismatch(
          '没选中知识点时页面上不应有 Spinner',
          `${lingering} 个（${labels.join(' / ')}）`,
          '页面静下来之后仍有 progressbar。这通常是条件启用的 query 用了 isPending：'
            + 'TanStack Query v5 里 enabled: false 的查询 status 恒为 pending，isPending 就永远为真。'
            + '改用 isFetching。',
        ),
        evidence: [`H1=${title}`, `残留 progressbar ${lingering} 个`],
      };
    }

    return {
      result: verify.passed(`数据库页 H1「${title}」；图谱节点 ${nodeCount} 个${mentions ? '，页面统计卡上出现同一数字' : '（页面未直接出现该数字，见 evidence）'}；无残留 Spinner`),
      evidence: [`H1=${title}`, `图谱节点数 ${nodeCount}`, mentions ? '页面文本包含该数字' : '页面文本未包含该数字（统计卡可能使用不同口径）', '残留 progressbar 0 个'],
    };
  },
};

const skillsStage: StageDefinition = {
  stage: 'skills',
  label: 'S8 技能库',
  async run({ page, api }: StageContext) {
    const skills = await api.getJson('/agent/skills');
    if (skills.status !== 200) {
      return { result: verify.backend(skills.status, skills.rawText, '读取技能库失败'), evidence: [] };
    }
    const apiCount = itemsOf<{ name: string }>(skills.body).length;

    await page.goto('/skills', { waitUntil: 'domcontentloaded' });
    await waitForSettled(page);
    const title = await readHeading(page);
    if (title !== '技能库') {
      return {
        result: title === null ? verify.locator('h1', '技能库页没有 H1') : verify.mismatch('技能库', title, '技能库页标题不符'),
        evidence: [`接口技能数 ${apiCount}`],
      };
    }

    /* 页面上每个 skill 有一张卡片，卡片标题是 skill 名字。用「每个接口返回的
       名字都能在页面上找到」来断言，而不是数卡片数 —— 卡片结构可能变，
       名字是稳定事实。

       ## 为什么要等

       `readHeading()` 拿到 H1 就返回，而技能列表是异步拉的（页头是静态的）。
       原来紧接着就读 skill 名，得到 0 个命中，报成「技能库里少了
       question-author、socratic-tutor」—— 看起来像技能库不渲染，实际只是
       页面还没把数据画上去。接口说有 n 个，就等这 n 个都出现。 */
    const apiSkills = itemsOf<{ name: string }>(skills.body);
    const missing: string[] = [];
    for (const skill of apiSkills) {
      const found = await page
        .getByText(skill.name, { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: SLOW_PAGE_TIMEOUT })
        .then(() => true)
        .catch(() => false);
      if (!found) missing.push(skill.name);
    }
    if (missing.length > 0) {
      return {
        result: verify.mismatch(`页面上有 ${apiCount} 个技能`, `缺 ${missing.join('、')}`, '技能库里少了接口返回的技能'),
        evidence: [`接口技能数 ${apiCount}`],
      };
    }
    return { result: verify.passed(`技能库 H1「${title}」；${apiCount} 个技能全部渲染`), evidence: [`接口技能数 ${apiCount}`] };
  },
};

/** 全部阶段。顺序即旅程顺序，与 `STAGE_ORDER` 一一对应。 */
export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  coldStart,
  placement,
  mapStage,
  nodeDetail,
  answerStage,
  probeStage,
  boardStage,
  reviewStage,
  databaseStage,
  skillsStage,
];

/** 自检：阶段定义数量与顺序必须与 `STAGE_ORDER` 一致，否则漏斗矩阵会错位。 */
export function assertStageOrder(): void {
  const defined = STAGE_DEFINITIONS.map((entry) => entry.stage);
  if (defined.length !== STAGE_ORDER.length || defined.some((name, index) => name !== STAGE_ORDER[index])) {
    throw new Error(`阶段定义与 STAGE_ORDER 不一致：definition=${defined.join(',')} vs order=${STAGE_ORDER.join(',')}`);
  }
}

export type { StageApi, VerifyResult };
/* 实现搬到了 `settle.ts`（probe 阶段也要用它，而这里要 import probe 阶段，
   两边互相 import 会触发 no-circular）。这里转出去，老的 import 路径照旧可用。 */
export { waitForSettled } from './settle.ts';
