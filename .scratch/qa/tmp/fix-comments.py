import io

edits = [
    ('apps/web/src/level/QuestionView.tsx',
     "   * 深 `#2A2A33` / 亮 `#FBEAEA`），描边换成品牌色 —— 底色 + 描边 + 圆点",
     "   * 深底近黑 / 亮底近粉），描边换成品牌色 —— 底色 + 描边 + 圆点"),
    ('apps/web/src/level/QuestionView.tsx',
     "   * （深 `#F5A524` / 亮 `#8A5200`，对各自 soft 底 7.98 / 5.67）。",
     "   * （深主题偏亮的琥珀、亮主题偏暗的褐，对各自 soft 底 7.98 / 5.67）。"),
    ('apps/web/src/level/VideoPanel.tsx',
     "   * 换成 `--sm-bg-sunken`（深 `#08080B` / 亮 `#E2E3E8`）：两套主题下它都",
     "   * 换成 `--sm-bg-sunken`（深主题近纯黑、亮主题浅灰）：两套主题下它都"),
    ('apps/web/src/level/VideoPanel.tsx',
     "   * 改之前这里是字面量 `#000`：深色主题下看着没问题，但**明亮主题下视频",
     "   * 改之前这里是写死的黑色：深色主题下看着没问题，但**明亮主题下视频"),
]

for path, old, new in edits:
    s = io.open(path, encoding='utf-8').read()
    assert s.count(old) == 1, (path, old, s.count(old))
    s = s.replace(old, new)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('patched', path)

# 同时检查 tokens.css 里是否有 --sm-warning-border（若有则用，否则用 colorPaletteDarkOrangeBorder1）
