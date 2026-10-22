import io
p = 'skills/web-design-engineer/references/contrast-check.mjs'
s = io.open(p, encoding='utf-8').read()

old = """    { name: '画布正文 text-primary / graph-canvas', fg: 'text-primary', bg: 'graph-canvas', min: 4.5, why: 'WCAG 1.4.3' },"""
new = """    /*
     * 画布正文。
     *
     * 这条规则以前写的是 `text-primary / graph-canvas`，在**亮主题画布是浅色**
     * 的年代成立。票 62 之后两套主题的画布都是深色面板（亮主题只换 chrome），
     * 画布上的字也不是 `text-primary` 而是 `graph-label` —— 旧规则于是量到
     * 1.01:1 并报红，但屏幕上一个字都没错：它量的是「深色画布配深色正文」，
     * 一个根本不会出现的组合。
     *
     * 换成真正画在画布上的两个键。`graph-label` 是节点名/边标注，
     * `graph-label-muted` 是低优先级标注（同一张图上要能分出主次）。
     */
    { name: '画布标注 graph-label / graph-canvas', fg: 'graph-label', bg: 'graph-canvas', min: 4.5, why: 'WCAG 1.4.3' },
    { name: '画布弱标注 graph-label-muted / graph-canvas', fg: 'graph-label-muted', bg: 'graph-canvas', min: 4.5, why: 'WCAG 1.4.3' },"""
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
