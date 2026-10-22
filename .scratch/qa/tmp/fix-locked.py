import io
p = 'apps/web/src/level/QuestionView.tsx'
s = io.open(p, encoding='utf-8').read()

old = """  /**
   * 已锁定（交卷后）。**刻意不让它「变淡」**：把禁用态画成低对比度是
   * 最省事的做法，代价是低视力学习者读不出自己刚选了什么 —— 而「我刚才
   * 选了哪个」正是交卷后最该能看清的信息。
   *
   * 所以禁用靠**虚线边框**（形状通道）表示，颜色仍是达标的 `border-control`。
   * WCAG 1.4.11 对禁用控件本可豁免，这里不豁免。
   */
  optionLocked: {
    border: `1px dashed ${tokens.colorNeutralStrokeAccessible}`,
    color: tokens.colorNeutralForeground3,
  },"""

new = """  /**
   * 已锁定（交卷后）。**刻意不让它「变淡」**：把禁用态画成低对比度是
   * 最省事的做法，代价是低视力学习者读不出自己刚选了什么 —— 而「我刚才
   * 选了哪个」正是交卷后最该能看清的信息。
   *
   * 所以禁用靠**虚线边框**（形状通道）表示。WCAG 1.4.11 对禁用控件本可
   * 豁免，这里不豁免。
   *
   * 颜色用 `colorNeutralForeground2`（= `--sm-text-secondary`）而不是
   * `colorNeutralStrokeAccessible`（= `border-control`）：锁定态可能落在
   * `bg-selected` 上（刚选中的那一项），而 `border-control` 对深色
   * `bg-selected` 只有 **2.82:1**，正好卡在 3:1 之下。`text-secondary`
   * 对 `bg-surface` 7.73 / 6.04（深）、`bg-selected` 6.04 / 6.34（浅），
   * 两种底、两套主题全部远超 3:1。
   */
  optionLocked: {
    border: `1px dashed ${tokens.colorNeutralForeground2}`,
    color: tokens.colorNeutralForeground2,
  },"""

assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
