import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { delay, http, HttpResponse } from 'msw';
import { SkillsPage, skillRowLabel } from './SkillsPage';
import { server } from '../test/msw';

/**
 * 票 15 在前端这一侧的验收。
 *
 * ## 这一页最容易做假的地方
 *
 * 「禁用」可以只做成一条数据库记录加一个灰色开关：列表返回 `enabled:false`，
 * 界面把开关关掉，测试断言「开关是关的」——全绿，但智能体那边该 skill 还在。
 * 所以这里断言的不是开关状态，而是**页面上给出的证据**：
 * - 禁用行有**文字**标记（只靠底色变化，色觉障碍与打印都会丢信息）；
 * - system message 预览区里那段文本真的短了一截；
 * - 点开关真的发出了 PATCH，且列表与预览都重新取了。
 *
 * ## 打桩约定
 *
 * `test/msw.ts` 的默认桩：socratic-tutor 启用、question-author 禁用。
 * 每条用例都从这份默认出发显式覆盖自己要的那部分，避免「默认桩恰好满足
 * 断言」这类假绿。
 *
 * ## 为什么不用 `textContent` 断言 Fluent 组件
 *
 * Fluent 在 DOM 里会留一份视觉隐藏的副本给读屏用，`textContent` 会把两份
 * 拼起来数出重复文字（票 08 踩过）。凡是按钮/开关/开关标签，一律
 * `getByRole(..., { name })`；纯文本段落才用 `getByText`。
 */

const renderSkills = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <SkillsPage />
      </QueryClientProvider>
    </FluentProvider>,
  );
};

const skillListItem = (overrides: Record<string, unknown> = {}) => ({
  name: 'socratic-tutor',
  directoryName: 'socratic-tutor',
  description: '当学习者卡住或直接要答案时，用苏格拉底式追问把他往前推一步。',
  version: '1.0.0',
  triggerScenarios: ['学生说不会', '学生直接要答案'],
  enabled: true,
  referenceCount: 1,
  ...overrides,
});

/** 默认桩里 question-author 那一行（描述与 socratic-tutor 不同，别拿错）。 */
const QUESTION_AUTHOR_ITEM = skillListItem({
  name: 'question-author',
  directoryName: 'question-author',
  description: '为微知识点出题，并校验已有题目是否可用。',
  triggerScenarios: ['出题', '校验题目'],
  enabled: false,
});

/**
 * 覆盖「按名字取详情」时**必须同时**把 system-preview 钉住。
 *
 * MSW 的 `:name` 只匹配一个路径段，`system-preview` 恰好也是一个段；而
 * `server.use()` 的处理器排在默认表前面。只覆盖 `:name` 会让预览请求被
 * 详情桩接走，页面拿到一个没有 `includedSkills` 的对象然后崩掉 ——
 * 症状是「测详情，预览区炸了」，与详情本身无关。
 */
const stubDetail = (getDetail: (name: string) => unknown) =>
  server.use(
    http.get('*/api/v1/agent/skills/system-preview', () =>
      HttpResponse.json({
        systemMessage: '基础提示词',
        includedSkills: ['socratic-tutor'],
        excludedSkills: [],
      }),
    ),
    http.get('*/api/v1/agent/skills/:name', ({ params }) =>
      HttpResponse.json({ skill: getDetail(String(params.name)) }),
    ),
  );

const skillDetail = (overrides: Record<string, unknown> = {}) => ({
  name: 'socratic-tutor',
  directoryName: 'socratic-tutor',
  description: '当学习者卡住或直接要答案时，用苏格拉底式追问把他往前推一步。',
  version: '1.0.0',
  triggerScenarios: ['学生说不会', '学生直接要答案'],
  enabled: true,
  referenceCount: 1,
  instructions: '一轮只问一个问题。\n不要给最终数值。',
  references: [{ name: 'phrasing.md', sizeBytes: 2247, preview: '一级：先问这个概念里有哪些量。' }],
  validation: { valid: true, errors: [], warnings: [] },
  ...overrides,
});

describe('列表：把 frontmatter 里的字段摊开', () => {
  it('加载时说明正在扫描目录，而不是空白页', async () => {
    server.use(
      http.get('*/api/v1/agent/skills', async () => {
        await delay(300);
        return HttpResponse.json({ directory: 'x', enabledCount: 0, disabledCount: 0, items: [] });
      }),
    );

    renderSkills();
    // 同步断言：首帧必须有个说法，不能是空白
    expect(screen.getByText('扫描 skill 目录…')).toBeInTheDocument();
  });

  it('目录里没有 skill 时，告诉人去哪儿建 SKILL.md', async () => {
    server.use(
      http.get('*/api/v1/agent/skills', () =>
        HttpResponse.json({
          directory: 'apps/api/src/mastra/skills',
          enabledCount: 0,
          disabledCount: 0,
          items: [],
        }),
      ),
    );

    renderSkills();
    await waitFor(() =>
      expect(screen.getByText(/这个目录下还没有 skill/)).toBeInTheDocument(),
    );
    // 空态不是「暂无数据」四个字：它得说清楚怎么让它不再空。
    // 整句锚定 —— 页面底部「怎么迁移和修改」那张卡里也有 SKILL.md 字样。
    expect(
      screen.getByText('这个目录下还没有 skill。新建 `<名字>/SKILL.md` 就会出现在这里。'),
    ).toBeInTheDocument();
    expect(screen.getByText('扫描自 apps/api/src/mastra/skills')).toBeInTheDocument();
  });

  it('每行给出名称、版本、触发场景、参考文件数', async () => {
    renderSkills();

    const row = await screen.findByRole('button', { name: skillRowLabel(skillListItem()) });
    expect(within(row).getByText('socratic-tutor')).toBeInTheDocument();
    expect(within(row).getByText('v1.0.0')).toBeInTheDocument();
    expect(within(row).getByText('学生说不会')).toBeInTheDocument();
    expect(within(row).getByText('1 个参考文件')).toBeInTheDocument();
  });

  it('读取失败时说清楚是哪一步失败了，不白屏', async () => {
    server.use(
      http.get('*/api/v1/agent/skills', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '服务器内部错误' }, { status: 500 }),
      ),
    );

    renderSkills();
    await waitFor(() => expect(screen.getByText('无法读取技能库')).toBeInTheDocument());
    expect(screen.getByText(/服务器内部错误/)).toBeInTheDocument();
  });
});

describe('禁用状态的标记不能只靠颜色', () => {
  it('禁用行带「已禁用」文字徽章，读屏名字里也有「禁用」', async () => {
    renderSkills();

    const row = await screen.findByRole('button', {
      name: skillRowLabel(QUESTION_AUTHOR_ITEM),
    });
    // 文字标记：色觉障碍、低对比度、打印都必须还能读到这条状态
    expect(within(row).getByText('已禁用')).toBeInTheDocument();
    // 无障碍名字里也要有状态，否则读屏只知道有这个名字
    expect(row.getAttribute('aria-label')).toContain('禁用');
    // 反面对照：启用行不该出现「已禁用」，否则上面那条可能只是全局文案
    const enabledRow = screen.getByRole('button', { name: skillRowLabel(skillListItem()) });
    expect(within(enabledRow).queryByText('已禁用')).not.toBeInTheDocument();
  });
});

describe('开关是真的发出请求，并且刷新相关数据', () => {
  it('点开关发出 PATCH，请求体是目标状态', async () => {
    const user = userEvent.setup();
    let patched: { name: string; body: { enabled?: boolean } } | undefined;

    server.use(
      http.patch('*/api/v1/agent/skills/:name', async ({ params, request }) => {
        patched = {
          name: String(params.name),
          body: (await request.json()) as { enabled?: boolean },
        };
        return HttpResponse.json({
          skill: skillDetail({ name: String(params.name), enabled: false }),
        });
      }),
    );

    renderSkills();
    const toggle = await screen.findByRole('switch', { name: 'socratic-tutor 启用开关' });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched?.name).toBe('socratic-tutor');
    // 传的是「要变成什么」，不是「当前是什么」—— 后者在网络重试时会翻回去
    expect(patched?.body).toEqual({ enabled: false });
  });

  it('切换后列表与 system message 预览都重新取，不会一处说禁用、一处还在', async () => {
    const user = userEvent.setup();
    let skillsCalls = 0;
    let previewCalls = 0;

    server.use(
      http.get('*/api/v1/agent/skills', () => {
        skillsCalls += 1;
        return HttpResponse.json({
          directory: 'apps/api/src/mastra/skills',
          enabledCount: 0,
          disabledCount: 1,
          items: [skillListItem({ enabled: false })],
        });
      }),
      http.get('*/api/v1/agent/skills/system-preview', () => {
        previewCalls += 1;
        return HttpResponse.json({
          systemMessage: '基础提示词\n\n（已禁用的 skill 不在里面）',
          includedSkills: [],
          excludedSkills: ['socratic-tutor'],
        });
      }),
      http.patch('*/api/v1/agent/skills/:name', ({ params }) =>
        HttpResponse.json({ skill: skillDetail({ name: String(params.name), enabled: false }) }),
      ),
    );

    renderSkills();
    const toggle = await screen.findByRole('switch', { name: 'socratic-tutor 启用开关' });
    await waitFor(() => expect(skillsCalls).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(previewCalls).toBeGreaterThanOrEqual(1));

    const beforeSkills = skillsCalls;
    const beforePreview = previewCalls;

    await user.click(toggle);

    // 只失效列表会让「已禁用」和预览里「它还在」同时成立 —— 那是这个功能最不能出的错
    await waitFor(() => expect(skillsCalls).toBeGreaterThan(beforeSkills));
    await waitFor(() => expect(previewCalls).toBeGreaterThan(beforePreview));
  });

  it('详情区的启用状态也跟着变（不能左边说禁用、右边说启用中）', async () => {
    const user = userEvent.setup();
    let enabled = true;

    stubDetail(() => skillDetail({ enabled }));
    server.use(
      http.patch('*/api/v1/agent/skills/:name', async ({ request }) => {
        const body = (await request.json()) as { enabled?: boolean };
        enabled = body.enabled ?? false;
        return HttpResponse.json({ skill: skillDetail({ enabled }) });
      }),
    );

    renderSkills();

    // 详情区默认选中第一个 skill。「已禁用」在列表行里也有一个徽章，
    // 所以必须限定在详情区里找 —— 否则断言会被左边那一行满足，
    // 右边到底有没有翻过来根本没验证。
    const detail = await screen.findByRole('region', { name: 'socratic-tutor 详情' });
    await waitFor(() => expect(within(detail).getByText('启用中')).toBeInTheDocument());

    await user.click(screen.getByRole('switch', { name: 'socratic-tutor 启用开关' }));

    await waitFor(() => expect(within(detail).getByText('已禁用')).toBeInTheDocument());
    expect(within(detail).queryByText('启用中')).not.toBeInTheDocument();
  });

  it('切换失败时只在这一行提示，页面其余部分照常', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch('*/api/v1/agent/skills/:name', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '数据库连接断了' }, { status: 500 }),
      ),
    );

    renderSkills();
    await user.click(await screen.findByRole('switch', { name: 'socratic-tutor 启用开关' }));

    await waitFor(() => expect(screen.getByText(/切换失败：/)).toBeInTheDocument());
    expect(screen.getByText(/数据库连接断了/)).toBeInTheDocument();
    // 列表还在（没有整页降级成错误页）
    expect(screen.getByRole('button', { name: skillRowLabel(skillListItem()) })).toBeInTheDocument();
  });
});

describe('详情：正文只读 + references 清单', () => {
  it('选中一个 skill 后能看到正文与参考文件清单', async () => {
    const user = userEvent.setup();
    renderSkills();

    await user.click(
      await screen.findByRole('button', {
        name: skillRowLabel(QUESTION_AUTHOR_ITEM),
      }),
    );

    await waitFor(() => expect(screen.getByText(/一轮只问一个问题/)).toBeInTheDocument());
    expect(screen.getByText('phrasing.md')).toBeInTheDocument();
    // 大小要可读，不能是 2247
    expect(screen.getByText('2.2 KB')).toBeInTheDocument();
    // 只读：没有任何输入框可以改正文
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('system message 预览：这一页的核心证据', () => {
  it('摊开真正会发给模型的文本，并点名被排除的 skill', async () => {
    renderSkills();

    await waitFor(() =>
      expect(screen.getByText(/这是下一轮对话真正会发给模型的文本/)).toBeInTheDocument(),
    );
    // 原文要真的渲染出来（不是只显示「N 个 skill」这种摘要）
    expect(screen.getByText(/### socratic-tutor（v1\.0\.0）/)).toBeInTheDocument();
    expect(screen.getByText('已排除 1 个：question-author')).toBeInTheDocument();
    expect(screen.getByText('包含 1 个')).toBeInTheDocument();
  });

  it('预览读取失败时说清楚，不影响列表', async () => {
    server.use(
      http.get('*/api/v1/agent/skills/system-preview', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '拼装失败' }, { status: 500 }),
      ),
    );

    renderSkills();
    await waitFor(() => expect(screen.getByText(/无法读取预览：/)).toBeInTheDocument());
    // 列表照常可用
    expect(screen.getByRole('button', { name: skillRowLabel(skillListItem()) })).toBeInTheDocument();
  });
});

describe('迁移说明：不做导入导出，页面要说清为什么', () => {
  it('写明 skill 就是文件、迁移靠带目录、开关存在数据库', async () => {
    renderSkills();

    // 五条验收的最后一条：「不做导入导出——迁移由文件系统天然支持，页面上要说清」。
    // 只写「暂不支持导入」等于没说；必须让人知道去改哪个文件、为什么不需要导入。
    await waitFor(() => expect(screen.getByText('怎么迁移和修改')).toBeInTheDocument());
    expect(screen.getByText(/mastra\/skills\/.+SKILL\.md/)).toBeInTheDocument();
    expect(screen.getByText(/网页里不提供在线编辑/)).toBeInTheDocument();
    expect(screen.getByText(/没有导入导出，也不需要/)).toBeInTheDocument();
    expect(screen.getByText(/重启后保持/)).toBeInTheDocument();
  });
});
