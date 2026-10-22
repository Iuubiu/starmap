#!/usr/bin/env node
/**
 * StarMap 双主题对比度探针。
 *
 * 用法：
 *   node skills/web-design-engineer/references/contrast-check.mjs           # 打印表格 + 判定
 *   node skills/web-design-engineer/references/contrast-check.mjs --table   # 只打印 token 表
 *
 * 为什么要有这个文件
 * ------------------
 * 「深色底上的文字够不够清楚」不能靠眼睛，也不能靠设计工具的取色器读数：
 * 同一个 hex 在不同底色上的实际比值差得很远，而人眼对 4.2 与 4.6 几乎无感。
 * 这里把 SKILL.md 里的 token 值抄成一份数据，按 WCAG 2.1 相对亮度公式逐条断言，
 * 任何一条不达标就以非零码退出 —— 于是「改了一个 hex 顺手把对比度改坏」这件事
 * 会在 CI 或本地一条命令里暴露，而不是等用户说「看不清」。
 *
 * 它**不读** `apps/web/src/theme/` 的运行时 token：本文件是规范侧的真源，
 * 与实现侧的一致性由「实现侧必须抄同一组值」这条约定 + 人工评审保证。
 * 之所以不共享一份数据，是因为本 skill 要能在 t58 落地之前就独立运行
 * （先定规范、后写实现），也要能在实现被改坏时独立报警（规范不跟着漂）。
 *
 * ## 2026-10-22 补的两个断言盲区（教训）
 *
 * 这个脚本曾经报 `TOTAL FAILURES: 0`，但它**漏断言了两条真实不达标的组合**：
 * `text-disabled` 对 `bg-canvas`、以及 `option-idle-border` 对任何底。
 * 全绿是假绿 —— 比红更危险，因为没人会去查一条没被写的断言。
 *
 * 补断言时立刻红了 4 条（`option-idle-border` 1.66 / 1.76 / 1.55 / 1.41）。
 * 追下去发现是**本文件的 `option-idle-border` 值抄旧了**：
 * 这里写的是 `#333C49` / `#C9D0DB`，而 `tokens.ts` 与 `tokens.css` 落地的是
 * `#6B7787` / `#7C8695`（= `border-control` 那组值）。以实现侧为准改了本文件 ——
 * 未选中态是学习者第一眼看到的状态，淡到 1.4:1 的描边等于没有边界。
 *
 * 顺带把 SKILL.md §1.5 那一行的值也改了，两边现在逐字一致
 * （`node -e` 脚本比对 30 个键，0 差异）。
 *
 * 零依赖：只用 node 内置能力，不引入任何包。
 */

// ---------------------------------------------------------------------------
// 两套 palette —— 语义键完全一致，只有值不同
// ---------------------------------------------------------------------------

/** 深色（默认）。 */
const DARK = {
  'bg-canvas': '#0A0C10',
  'bg-surface': '#111419',
  'bg-elevated': '#171B22',
  'bg-hover': '#1F242C',
  'bg-selected': '#272E3A',
  'bg-input': '#0D1015',
  'bg-scrim': 'rgba(5,7,10,0.72)',

  'border-hairline': '#242B36',
  'border-control': '#6B7787',
  'border-focus': '#A79BFF',

  'text-primary': '#E9EEF5',
  'text-secondary': '#A3AEBE',
  'text-tertiary': '#8B98AA',
  'text-disabled': '#727C8A',

  accent: '#A79BFF',
  'accent-fill': '#6E5AF0',
  'accent-hover': '#6350E0',
  'accent-pressed': '#4E3CB5',
  'accent-soft': '#1C1930',
  'on-accent': '#FFFFFF',

  success: '#3FBF7F',
  warning: '#E8A33D',
  danger: '#FF7A7A',
  info: '#5AA0FF',
  'success-soft': '#10241B',
  'warning-soft': '#2A1E0C',
  'danger-soft': '#2C1414',
  'info-soft': '#101C2E',

  'graph-canvas': '#0A0C10',
  'graph-node-unseen': '#5A6A80',
  'graph-node-learning': '#4C8DFF',
  'graph-node-mastered': '#3FBF7F',
  'graph-node-review': '#E8A33D',

  'option-idle-border': '#6B7787',
  'option-hover-bg': '#1F242C',
  'option-selected-bg': '#1C1930',
  'option-selected-border': '#A79BFF',
  'option-correct': '#3FBF7F',
  'option-wrong': '#FF7A7A',
};

/** 明亮。不是深色反相：表面靠「更白 + 更浅 hairline」分层，不靠阴影。 */
const LIGHT = {
  'bg-canvas': '#F2F4F8',
  'bg-surface': '#FFFFFF',
  'bg-elevated': '#FFFFFF',
  'bg-hover': '#F0F2F6',
  'bg-selected': '#EDE9FC',
  'bg-input': '#FFFFFF',
  'bg-scrim': 'rgba(18,22,28,0.32)',

  'border-hairline': '#E3E7EE',
  'border-control': '#7C8695',
  'border-focus': '#6A55D8',

  'text-primary': '#12161C',
  'text-secondary': '#4B5563',
  'text-tertiary': '#5F6773',
  'text-disabled': '#767E8A',

  accent: '#6A55D8',
  'accent-fill': '#6A55D8',
  'accent-hover': '#5B47C8',
  'accent-pressed': '#4E3CB5',
  'accent-soft': '#EFECFD',
  'on-accent': '#FFFFFF',

  success: '#0E7A4A',
  warning: '#8A5200',
  danger: '#C62828',
  info: '#1A5FD0',
  'success-soft': '#E6F5EE',
  'warning-soft': '#FBF0DF',
  'danger-soft': '#FBEAEA',
  'info-soft': '#E8F0FC',

  'graph-canvas': '#F2F4F8',
  'graph-node-unseen': '#6B7787',
  'graph-node-learning': '#1A5FD0',
  'graph-node-mastered': '#0E7A4A',
  'graph-node-review': '#8A5200',

  'option-idle-border': '#7C8695',
  'option-hover-bg': '#F0F2F6',
  'option-selected-bg': '#EFECFD',
  'option-selected-border': '#6A55D8',
  'option-correct': '#0E7A4A',
  'option-wrong': '#C62828',
};

// ---------------------------------------------------------------------------
// WCAG 2.1 相对亮度与对比度
// ---------------------------------------------------------------------------

/** `#RGB` / `#RRGGBB` → [r, g, b]（0–255）。 */
function hexToRgb(hex) {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB 分量 → 线性光。 */
function linearize(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度。 */
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** 对比度比值（1–21）。 */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const round = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// 断言规则 —— 每条都能追到 WCAG 的一个具体条款
// ---------------------------------------------------------------------------

/**
 * @typedef {{ name: string, fg: string, bg: string, min: number, why: string }} Rule
 */

/** 正文 / 次要 / 三级 / 强调 / 语义：都要 4.5:1（WCAG 1.4.3 AA 正文）。 */
function textRules() {
  /** @type {Rule[]} */
  const rules = [];
  const body = [
    ['text-primary', '正文'],
    ['text-secondary', '次要'],
    ['text-tertiary', '三级'],
  ];
  for (const [fg, label] of body) {
    for (const bg of ['bg-surface', 'bg-canvas', 'bg-elevated', 'bg-hover', 'bg-selected']) {
      rules.push({ name: `${label} ${fg} / ${bg}`, fg, bg, min: 4.5, why: 'WCAG 1.4.3' });
    }
  }
  /*
   * `bg-canvas` 必须在这一组里。
   *
   * 曾经漏掉过：`StepRail` 的「跳过」段把 `text-disabled` 直接画在页面底色
   * （`bg-canvas`）上，而不是卡片底上，于是「禁用文字对 surface/hover/selected
   * 都达标」这句在评审里看着全绿，实际那一段的对比度只有 1.88（旧 Fluent
   * `colorNeutralForegroundDisabled`）/ 3.72（本仓 `text-disabled`）。漏的是
   * **断言集**，不是数值 —— 这种假绿比红更危险，因为没人会去查一条没被写的断言。
   */
  for (const bg of ['bg-surface', 'bg-canvas', 'bg-hover', 'bg-selected']) {
    rules.push({ name: `禁用 text-disabled / ${bg}`, fg: 'text-disabled', bg, min: 3, why: '本仓加严（WCAG 对禁用态豁免）' });
  }
  for (const bg of ['bg-surface', 'bg-elevated', 'bg-hover']) {
    rules.push({ name: `强调 accent / ${bg}`, fg: 'accent', bg, min: 4.5, why: 'WCAG 1.4.3' });
  }
  rules.push({ name: '强调 accent / accent-soft', fg: 'accent', bg: 'accent-soft', min: 4.5, why: 'WCAG 1.4.3' });
  for (const bg of ['accent-fill', 'accent-hover', 'accent-pressed']) {
    rules.push({ name: `按钮字 on-accent / ${bg}`, fg: 'on-accent', bg, min: 4.5, why: 'WCAG 1.4.3' });
  }
  for (const [fg, label] of [
    ['success', '成功'],
    ['warning', '警告'],
    ['danger', '危险'],
    ['info', '信息'],
  ]) {
    rules.push({ name: `语义 ${label} ${fg} / bg-surface`, fg, bg: 'bg-surface', min: 4.5, why: 'WCAG 1.4.3' });
  }
  for (const [fg, label] of [
    ['success', '成功'],
    ['warning', '警告'],
    ['danger', '危险'],
    ['info', '信息'],
  ]) {
    const soft = `${fg}-soft`;
    rules.push({ name: `MessageBar ${label} ${fg} / ${soft}`, fg, bg: soft, min: 4.5, why: 'WCAG 1.4.3' });
  }
  return rules;
}

/** 控件边界 / 焦点环：3:1（WCAG 1.4.11 非文本对比）。 */
function componentRules() {
  return /** @type {Rule[]} */ ([
    { name: '控件边界 border-control / bg-surface', fg: 'border-control', bg: 'bg-surface', min: 3, why: 'WCAG 1.4.11' },
    { name: '控件边界 border-control / bg-canvas', fg: 'border-control', bg: 'bg-canvas', min: 3, why: 'WCAG 1.4.11' },
    { name: '焦点环 border-focus / bg-surface', fg: 'border-focus', bg: 'bg-surface', min: 3, why: 'WCAG 1.4.11' },
  ]);
}

/** 图谱画布与关卡选项：图/答题元件必须 ≥3:1 才能被辨出。 */
function sceneRules() {
  return /** @type {Rule[]} */ ([
    { name: '画布正文 text-primary / graph-canvas', fg: 'text-primary', bg: 'graph-canvas', min: 4.5, why: 'WCAG 1.4.3' },
    { name: '节点 未学 / graph-canvas', fg: 'graph-node-unseen', bg: 'graph-canvas', min: 3, why: 'WCAG 1.4.11' },
    { name: '节点 在学 / graph-canvas', fg: 'graph-node-learning', bg: 'graph-canvas', min: 3, why: 'WCAG 1.4.11' },
    { name: '节点 已掌握 / graph-canvas', fg: 'graph-node-mastered', bg: 'graph-canvas', min: 3, why: 'WCAG 1.4.11' },
    { name: '节点 需复验 / graph-canvas', fg: 'graph-node-review', bg: 'graph-canvas', min: 3, why: 'WCAG 1.4.11' },
    { name: '选项 对 option-correct / bg-surface', fg: 'option-correct', bg: 'bg-surface', min: 4.5, why: 'WCAG 1.4.3' },
    { name: '选项 错 option-wrong / bg-surface', fg: 'option-wrong', bg: 'bg-surface', min: 4.5, why: 'WCAG 1.4.3' },
    { name: '选项字 text-primary / option-selected-bg', fg: 'text-primary', bg: 'option-selected-bg', min: 4.5, why: 'WCAG 1.4.3' },
    { name: '选项字 text-primary / option-hover-bg', fg: 'text-primary', bg: 'option-hover-bg', min: 4.5, why: 'WCAG 1.4.3' },
    { name: '选项选中边 option-selected-border / bg-surface', fg: 'option-selected-border', bg: 'bg-surface', min: 3, why: 'WCAG 1.4.11' },
    /*
     * 选项**未选中**的边界。
     *
     * 曾经漏掉过：这个键在 §1.5 表里有、在 `tokens.ts` 里有、在
     * `QuestionView.tsx` 里被用来画每个选项的 1px 描边，**唯独不在断言集里**。
     * 漏它的后果和 `text-disabled` 那条一样：脚本全绿，而屏幕上「哪些是可以点的
     * 选项」这条边界信息实际淡到看不见。未选中态恰恰是学习者第一眼看到的状态 ——
     * 已经选中的那个不用边界也认得出来，没选中的才需要。
     *
     * 两种底都要断言：选项既可能落在卡片底（`bg-surface`）上，也可能直接落在
     * 页面底（`bg-canvas`）上，两者亮度不同，比值也不同。
     */
    { name: '选项未选边 option-idle-border / bg-surface', fg: 'option-idle-border', bg: 'bg-surface', min: 3, why: 'WCAG 1.4.11' },
    { name: '选项未选边 option-idle-border / bg-canvas', fg: 'option-idle-border', bg: 'bg-canvas', min: 3, why: 'WCAG 1.4.11' },
  ]);
}

/** 装饰性 hairline：不参与判定，但要打印出来让人看见它有多弱。 */
function decorativeRatios(p) {
  return {
    'hairline / surface': round(contrast(p['border-hairline'], p['bg-surface'])),
    'hairline / canvas': round(contrast(p['border-hairline'], p['bg-canvas'])),
    'elevated / surface': round(contrast(p['bg-elevated'], p['bg-surface'])),
    'hover / surface': round(contrast(p['bg-hover'], p['bg-surface'])),
    'selected / surface': round(contrast(p['bg-selected'], p['bg-surface'])),
    'canvas / surface': round(contrast(p['bg-canvas'], p['bg-surface'])),
  };
}

// ---------------------------------------------------------------------------
// 跑
// ---------------------------------------------------------------------------

const RULES = [...textRules(), ...componentRules(), ...sceneRules()];

/** 按角色汇总「最差的那个比值」——评审看这一组数字就够。 */
function worstByRole(p) {
  const min = (pairs) => round(Math.min(...pairs.map(([fg, bg]) => contrast(p[fg], p[bg]))));
  return {
    '正文 text-primary': min(['bg-surface', 'bg-canvas', 'bg-elevated', 'bg-hover', 'bg-selected'].map((bg) => ['text-primary', bg])),
    '次要 text-secondary': min(['bg-surface', 'bg-canvas', 'bg-elevated', 'bg-hover', 'bg-selected'].map((bg) => ['text-secondary', bg])),
    '三级 text-tertiary': min(['bg-surface', 'bg-canvas', 'bg-elevated', 'bg-hover', 'bg-selected'].map((bg) => ['text-tertiary', bg])),
    '禁用 text-disabled': min(['bg-surface', 'bg-canvas', 'bg-hover', 'bg-selected'].map((bg) => ['text-disabled', bg])),
    '强调 accent（文字/图标）': min(['bg-surface', 'bg-elevated', 'bg-hover', 'accent-soft'].map((bg) => ['accent', bg])),
    '按钮字 on-accent': min(['accent-fill', 'accent-hover', 'accent-pressed'].map((bg) => ['on-accent', bg])),
    '控件边界 border-control': min([['border-control', 'bg-surface'], ['border-control', 'bg-canvas']]),
    '选项未选边 option-idle-border': min([['option-idle-border', 'bg-surface'], ['option-idle-border', 'bg-canvas']]),
    '图谱节点四态': min(['graph-node-unseen', 'graph-node-learning', 'graph-node-mastered', 'graph-node-review'].map((fg) => [fg, 'graph-canvas'])),
    '关卡选项 对/错': min([['option-correct', 'bg-surface'], ['option-wrong', 'bg-surface']]),
  };
}

function run() {
  const tableOnly = process.argv.includes('--table');
  let failures = 0;

  for (const [themeName, p] of [
    ['DARK', DARK],
    ['LIGHT', LIGHT],
  ]) {
    if (!tableOnly) console.log(`\n===== ${themeName} =====`);
    if (tableOnly) {
      for (const [key, value] of Object.entries(p)) console.log(`| \`--sm-${key}\` | ${value} |`);
      console.log('');
      continue;
    }

    for (const rule of RULES) {
      const value = round(contrast(p[rule.fg], p[rule.bg]));
      const ok = value >= rule.min;
      if (!ok) failures += 1;
      console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${rule.name.padEnd(42)} ${String(value).padStart(6)}  (>= ${rule.min})  ${rule.why}`,
      );
    }

    console.log(`  rules: ${RULES.length}, all pass: ${failures === 0}`);
    console.log('  decorative:', JSON.stringify(decorativeRatios(p)));
    console.log('  worst-per-role:', JSON.stringify(worstByRole(p), null, 2).replace(/\n/g, '\n  '));
  }

  if (!tableOnly) {
    console.log(`\nTOTAL FAILURES: ${failures}`);
    if (failures > 0) process.exitCode = 1;
  }
}

run();
