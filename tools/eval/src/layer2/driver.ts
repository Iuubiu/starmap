/**
 * 第二层的驱动骨架：把「模型给的动作」变成「浏览器里真发生的点击」。
 *
 * 这一层只做三件事，其余全部交给调用方：
 *  ① 把页面上的可交互元素抓成候选表（role + accessible name + 几何）；
 *  ② 用 assess/resolve 决定点哪一个，解析不到就记 locator_failure；
 *  ③ 执行动作并把每一步的结局写进 StepRecord 列表。
 *
 * 它**不生成动作**——动作来自 Actor：现在是 ScriptedActor（确定性、可复现、
 * 不需要模型），票 20 的最终形态接 LlmActor。这样分层的好处是：界面上真的
 * 点不动的那些问题，今天就能测出来，不必等模型接好。
 */

import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { parseAgentAction, type AgentAction, type StepOutcome, type StepRecord } from './action.ts';
import { resolveTarget, type TargetCandidate } from './resolve.ts';

/** 生成动作的一方。所有实现都必须是纯「看屏幕 → 出动作」，不碰浏览器。 */
export interface Actor {
  readonly name: string;
  /** 看到当前屏幕文本，返回原始输出（未解析的字符串）。 */
  next(input: { screen: string; turn: number; stage: string; progressNote?: string }): Promise<string>;
}

/**
 * 在页面里抓候选元素。
 *
 * role 用显式属性 + 标签名启发式判断，而不是拉 axe-core：
 * ① 少一个依赖；② 我们要的是「人能指得准的元素」，不是完整 ARIA 树。
 * accessible name 的取法按 ARIA 优先级简化为：aria-label → aria-labelledby →
 * 文本内容 → placeholder → title。够用，且不会因为实现复杂而漂移。
 */
/* 末尾的 `()` 不能少：page.evaluate 传字符串时按**表达式**求值，传 `() => {...}`
   得到的是一个函数对象（序列化成 undefined），不会自动调用。踩过一次：
   候选表变成 undefined，报 "Cannot read properties of undefined (reading 'filter')"，
   而 cast 成 TargetCandidate[] 让类型检查完全看不见这个错。 */
const COLLECT_SCRIPT = `(() => {
  const results = [];
  const seen = new Set();
  const candidates = document.querySelectorAll(
    'button, a, input, textarea, select, [role], [tabindex]:not([tabindex="-1"])'
  );
  let index = 0;
  for (const el of candidates) {
    if (seen.has(el)) continue;
    seen.add(el);
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) > 0.05;
    if (!visible) continue;

    let name = (el.getAttribute('aria-label') || '').trim();
    if (!name) {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        name = labelledBy
          .split(/\\s+/)
          .map((id) => document.getElementById(id)?.innerText || '')
          .join(' ')
          .trim();
      }
    }
    if (!name) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        name = (el.getAttribute('placeholder') || el.getAttribute('title') || '').trim();
      } else {
        /* 用 innerText 而不是 textContent：Fluent UI 的 Tab 会渲染一个
           display:none 的「预留宽度」副本来避免标签随内容抖动，textContent
           会把它一起读进来，得到「看板看板」这种**采集器制造的**假名。
           而 Playwright 的 ARIA 计算给出的是「看板」。用 innerText 才与
           真实可访问名一致 —— 否则我们会往报告里写一堆并不存在的界面缺陷。 */
        name = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      }
    }
    if (!name) continue;
    if (name.length > 160) name = name.slice(0, 160);

    let role = (el.getAttribute('role') || '').trim().toLowerCase();
    if (!role) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'button') role = 'button';
      else if (tag === 'a') role = 'link';
      else if (tag === 'input' || tag === 'textarea') role = 'textbox';
      else if (tag === 'select') role = 'combobox';
      else role = tag;
    }

    results.push({
      index: index++,
      role,
      name,
      tag: el.tagName.toLowerCase(),
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      visible: true
    });
  }
  return results;
})()`;

/** 已知噪声的白名单。见构造函数里的说明：短、且每条都有出处。 */
const BENIGN_CONSOLE_PATTERNS: RegExp[] = [
  /favicon/i,
  /net::ERR_INTERNET_DISCONNECTED/i,
  /Keyborg instance/i,
];

export interface DriverOptions {
  baseUrl: string;
  /** 每步最多等多久（毫秒）。界面卡死时不要静默等到天荒地老。 */
  stepTimeoutMs?: number;
  /** 每步之后等页面稳定时间，给查询与渲染留出余地。 */
  settleMs?: number;
}

export class EvalDriver {
  readonly page: Page;
  private readonly context: BrowserContext;
  private readonly options: Required<DriverOptions>;
  readonly steps: StepRecord[] = [];
  /** 从头到尾的 console error，报告里"无 console error"这条要靠它。 */
  readonly consoleErrors: string[] = [];
  private readonly screenTexts: string[] = [];

  private constructor(page: Page, context: BrowserContext, options: Required<DriverOptions>) {
    this.page = page;
    this.context = context;
    this.options = options;

    this.page.on('console', (message) => {
      if (message.type() === 'error') {
        const text = message.text();
        /* 只过滤两类已知噪声，且都有据可查：
           - favicon / 断网：网络层，不是界面缺陷；
           - Keyborg（Fluent UI 的键盘导航管理器）在 Fast Refresh 下重复实例化的
             警告：`pnpm test` 的 vitest stderr 里也有同一条，属持续存在的既有噪声。
           白名单必须短且写清理由 —— 它一旦变长，就会开始掩盖真问题。 */
        if (BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return;
        this.consoleErrors.push(text.slice(0, 300));
      }
    });
    this.page.on('pageerror', (error) => {
      this.consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`);
    });
  }

  static async create(browser: Browser, options: DriverOptions): Promise<EvalDriver> {
    const resolved: Required<DriverOptions> = {
      baseUrl: options.baseUrl,
      stepTimeoutMs: options.stepTimeoutMs ?? 10_000,
      settleMs: options.settleMs ?? 400,
    };
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      /* baseURL 必须设：阶段里用的是相对路径 `page.goto('/placement')`。
         不设不会报「缺少 baseURL」，而是报
         `Protocol error (Page.navigate): Cannot navigate to invalid URL` ——
         九段全部变成 assertion_mismatch，看起来像界面全坏了。 */
      baseURL: resolved.baseUrl,
    });
    const page = await context.newPage();
    return new EvalDriver(page, context, resolved);
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(`${this.options.baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(this.options.settleMs);
  }

  /** 当前屏幕上所有人能读到的文字。给 Actor 用，也是报告的引文来源。 */
  async screenText(): Promise<string> {
    const text = await this.page.evaluate(`() => document.body.innerText`);
    const normalized = String(text).replace(/\n{3,}/g, '\n\n').trim();
    this.screenTexts.push(normalized);
    return normalized;
  }

  accessibilitySnapshot(): string[] {
    return [...this.screenTexts];
  }

  async candidates(): Promise<TargetCandidate[]> {
    const raw = (await this.page.evaluate(COLLECT_SCRIPT)) as unknown;
    /* 显式校验而不是 cast：evaluate 的结果是 any，一处笔误（比如漏掉末尾的
       调用括号）会让候选表变成 undefined，然后在别处报一个完全无关的错。
       在这里失败，错误信息才指向真正的原因。 */
    if (!Array.isArray(raw)) {
      throw new Error(`候选元素采集失败：期望数组，实际拿到 ${typeof raw}。检查 COLLECT_SCRIPT 是否被正确调用。`);
    }
    return raw as TargetCandidate[];
  }

  /**
   * 跑一步：解析动作 → 定位 → 执行 → 记录。
   *
   * 失败从不抛异常：每一条失败都是一份观测数据（locator_failure 的数量本身
   * 就是票 20 要求的产出之一）。真异常（浏览器崩了）才往外抛。
   */
  async step(params: { turn: number; stage: string; raw: string }): Promise<StepRecord> {
    const started = performance.now();
    const { turn, stage, raw } = params;
    const record = (partial: Omit<StepRecord, 'turn' | 'stage' | 'durationMs' | 'action'> & { action: AgentAction | null }): StepRecord => ({
      turn,
      stage,
      action: partial.action,
      outcome: partial.outcome,
      ...(partial.target ? { target: partial.target } : {}),
      ...(partial.candidates ? { candidates: partial.candidates.slice(0, 8) } : {}),
      detail: partial.detail,
      durationMs: Math.round(performance.now() - started),
    });

    const parsed = parseAgentAction(raw);
    if (!parsed.ok || !parsed.action) {
      return record({
        action: null,
        outcome: 'protocol_violation',
        detail: parsed.protocolError ?? '未知协议错误',
      });
    }
    const action = parsed.action;

    if (action.action === 'give_up') {
      return record({ action, outcome: 'gave_up', detail: action.note || '学生放弃' });
    }
    if (action.action === 'skip') {
      return record({ action, outcome: 'skipped', detail: action.note || '学生跳过' });
    }
    if (action.action === 'scroll') {
      const direction = /下|底|down/i.test(action.target_hint) ? 1 : -1;
      await this.page.mouse.wheel(0, direction * 500);
      await this.page.waitForTimeout(this.options.settleMs);
      return record({ action, outcome: 'acted', detail: `滚动 ${direction > 0 ? '向下' : '向上'}` });
    }

    const candidates = await this.candidates();
    const viewport = this.page.viewportSize() ?? { width: 1440, height: 900 };
    const resolved = resolveTarget(action.target_hint, candidates, {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    });

    if (!resolved.ok) {
      return record({
        action,
        outcome: 'locator_failure',
        detail: resolved.reason,
        candidates: resolved.scored.map((entry) => entry.candidate),
      });
    }

    const target = resolved.target;
    const locator = this.locate(target);
    const targetInfo = { role: target.role, name: target.name, index: target.index };

    try {
      if (action.action === 'type') {
        await locator.click({ timeout: this.options.stepTimeoutMs });
        await locator.fill(action.text, { timeout: this.options.stepTimeoutMs });
        return record({
          action,
          outcome: 'acted',
          target: targetInfo,
          detail: `输入 ${action.text.length} 字：${action.text.slice(0, 40)}`,
        });
      }

      if (action.action === 'click' || action.action === 'submit_form') {
        const box = await locator.boundingBox();
        if (!box) {
          return record({ action, outcome: 'not_actionable', target: targetInfo, detail: '元素没有可见盒模型' });
        }
        await locator.click({ timeout: this.options.stepTimeoutMs });
        await this.page.waitForTimeout(this.options.settleMs);
        return record({ action, outcome: 'acted', target: targetInfo, detail: resolved.reason });
      }
    } catch (error) {
      /* 点了但没点动（遮挡、disabled、动画中）—— 不是 locator_failure：
         目标是对的，是界面让它不可用。这两者修法完全不同，必须分开记。 */
      return record({
        action,
        outcome: 'not_actionable',
        target: targetInfo,
        detail: `目标解析正确但操作失败：${(error as Error).message.split('\n')[0]?.slice(0, 200)}`,
      });
    }

    return record({ action, outcome: 'protocol_violation', detail: `未处理的动作类型：${String(action.action)}` });
  }

  /** 用 role+name 精确定位（不用 nth，因为候选表里的 index 是快照序号）。 */
  private locate(target: TargetCandidate): Locator {
    const page = this.page;
    switch (target.role) {
      case 'button':
        return page.getByRole('button', { name: target.name, exact: true }).first();
      case 'link':
        return page.getByRole('link', { name: target.name, exact: true }).first();
      case 'tab':
        return page.getByRole('tab', { name: target.name, exact: true }).first();
      case 'textbox':
        return page.getByRole('textbox', { name: target.name, exact: true }).first();
      case 'heading':
        return page.getByRole('heading', { name: target.name, exact: true }).first();
      default:
        return page.getByText(target.name, { exact: true }).first();
    }
  }

  /** 统计各类结局，报告直接吃这个。 */
  friction(): {
    locatorFailure: number;
    ambiguousTarget: number;
    notActionable: number;
    protocolViolation: number;
    gaveUpAt: number | null;
    skipped: number;
    acts: number;
  } {
    const count = (outcome: StepOutcome): number => this.steps.filter((step) => step.outcome === outcome).length;
    return {
      locatorFailure: count('locator_failure'),
      ambiguousTarget: count('ambiguous_target'),
      notActionable: count('not_actionable'),
      protocolViolation: count('protocol_violation'),
      gaveUpAt: this.steps.find((step) => step.outcome === 'gave_up')?.turn ?? null,
      skipped: count('skipped'),
      acts: count('acted'),
    };
  }

  /** 每步都记；调用方拿得到完整轨迹用于报告。 */
  record(step: StepRecord): void {
    this.steps.push(step);
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: false });
  }
}

/**
 * 脚本化 Actor：**不是模型**，按 persona 的规则生成动作序列。
 *
 * 它的价值不在于"像人"，而在于给出**可复现的基线**：
 * 同样的代码、同样的界面，跑两次得到同样的轨迹。任何差异就一定是界面变了，
 * 而不是模型抽风。票 20 的最终形态是 LlmActor，但这个基线必须一直留着 ——
 * 否则模型一升级，历史报告就没法比了。
 */
export class ScriptedActor implements Actor {
  readonly name: string;
  private readonly script: string[];
  private cursor = 0;

  constructor(name: string, script: string[]) {
    this.name = name;
    this.script = script;
  }

  /* 参数不用（脚本是固定的），但签名要与 Actor 一致：调用方不该知道
     对面是脚本还是模型 —— 否则换 Actor 实现时调用方要改，很容易改漏一处。 */
  next(_input: { screen: string; turn: number; stage: string; progressNote?: string }): Promise<string> {
    const item = this.script[this.cursor] ?? JSON.stringify({ action: 'give_up', target_hint: '', text: '', note: '脚本用完' });
    this.cursor += 1;
    return Promise.resolve(item);
  }

  get exhausted(): boolean {
    return this.cursor >= this.script.length;
  }
}
