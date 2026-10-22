import io
p = 'apps/web/src/level/CardView.tsx'
s = io.open(p, encoding='utf-8').read()

old = """  figure: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderLeft: `3px solid ${tokens.colorBrandStroke2}`,
    background: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusSmall,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },"""

new = """  /**
   * 图注块（「图 3-2 · 摘自《核电子学》p.118」这类）。
   *
   * 左侧 3px 竖条用 `colorBrandStroke1`（= `--sm-accent`）而不是
   * `colorBrandStroke2`（= `--sm-accent-soft`）：后者是**给底用的柔化色**，
   * 对 `bg-canvas` 只有 1.13:1 / 1.01:1 —— 画成 3px 竖条等于什么都没画。
   * `accent` 对 `bg-canvas` 是 7.08 / 4.80，两套主题都远超 3:1。
   *
   * 这条竖条是「这是引用材料，不是关卡正文」的唯一视觉线索，看不见就等于
   * 学习者在读一段不知道出处的文字。
   */
  figure: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusSmall,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },"""

assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
