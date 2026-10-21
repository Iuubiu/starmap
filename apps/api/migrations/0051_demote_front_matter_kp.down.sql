-- 回滚 0051：把 5 条书首前置页节点恢复成叶节点。
--
-- 为什么可以安全回滚：`is_leaf` 是**目录的派生事实**（book front matter 是不是
-- 一个可掌握的知识点），不是学习者数据。这 5 条在降级前也没有任何作答/掌握度/
-- 关卡/入边，所以回滚只是把布尔翻回去，不会凭空造出学习记录。
--
-- 用与 up 完全相同的 id 列表（不用 source_id / depth 之类的宽条件）：
-- 无条件把「所有 depth=0 的节点」翻成叶会把 seed 的 `kp-logic`（depth 0、
-- 本来就不是叶）也改坏。
UPDATE app.knowledge_points
   SET is_leaf = true
 WHERE id IN (
         'kp-lihansun-5e-vol1-p2-上册',
         'kp-yanshi-6e-p1-绪论',
         'kp-wangzhiying-1989-p1-目電录',
         'kp-wangzhiying-1989-p1-绪论',
         'kp-jichangsong-1990-p1-概念与术语'
       )
   AND is_leaf = false;
