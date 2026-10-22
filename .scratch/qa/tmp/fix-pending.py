import io
p = 'apps/web/src/level/QuestionView.tsx'
s = io.open(p, encoding='utf-8').read()

old = """  /** 已提交、对错未知（复验题）：中性底色，不暗示任何一种结果。 */
  pendingBar: {
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },"""

new = """  /**
   * 已提交、对错未知（复验题）：中性底色，不暗示任何一种结果。
   *
   * 边框用 `colorNeutralStrokeAccessible`（= `border-control`）而不是
   * `colorNeutralStroke2`（= `border-hairline`，深 1.09 / 亮 1.23）：
   * 这条 bar 是「你的答案已经交上去了，正在等结果」的唯一提示，边框若
   * 淡到看不见，它就和普通的段落块没区别了。对 `bg-elevated` 是
   * 深 3.37 / 亮 4.50，两套主题都达标。
   */
  pendingBar: {
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStrokeAccessible}`,
  },"""

assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
