/**
 * 右栏「正在学」卡（票 03 / spec T3，形状见 composer-b4.html B5 的
 * 「正在学：名 · 逻辑代数 · 第 1 章 · 已有可打开的关卡」）。
 *
 * ## 为什么知识点名字回到了侧栏
 *
 * 票 01 之前名字住在输入框上方的细条里（`context` 插槽），所以侧栏刻意
 * 不再写一遍。B5 定版把细条摘了（spec §0：开口即开始，知识点由对话推断后
 * **展示**在右栏），名字的唯一居所就换成这张卡 —— 「侧栏不出现名字」的旧
 * 口径随之作废。
 *
 * ## 名字与详情的分工
 *
 * 名字由调用方传进来（沿用 `nodeItems.find(...)?.name ?? node.name ?? id`
 * 的解析链，首页已经算好）；卡内只自调 `useNodeDetail` 取**详情才有**的
 * 三样：`ancestors`（章节路径，票 08）、`source.pageLabel`（服务端拼好的
 * 整句）与 `levels`（关卡入口）。与页面已有的同名请求共用 react-query 缓存，
 * 不会发两次。
 *
 * ## 来源行的两态（票 08）
 *
 * - 有 `ancestors`（非空数组）→ 主行显示「章 · 节 · …」：`join(' · ')` 的
 *   分隔符是**前端文案**（契约注释写明：哪几级、什么顺序是数据，分隔符不同
 *   行宽下可能换），拼法只允许存在这一处。书名页码整句降为悬浮（title）。
 * - `ancestors` 为空但有 `source` → 沿用 pageLabel 当来源行（旧形态）。
 * - 手工 kp（ancestors 空且无 source）→ 整行不渲染，不是「来源：—」——
 *   「—」会让人以为有一本没读到的书，而真相是这本就是手工写的示例点。
 *
 * ## 关卡入口的两态
 *
 * `levels` 非空 → 「打开关卡」跳 `/level/:levelId`（取第一个，与
 * `HomePage` 算 `focusedLevelId` 的口径一致）；空 → 只提示
 * 「还没有关卡，说一句让我生成」—— **不自动生成**：生成是一次昂贵的
 * 服务端动作，入口在学习者自己嘴里，替他点下去就是替他做了决定。
 */import { Button, Caption1, Card, Text } from '@fluentui/react-components';
import { useNavigate } from 'react-router';
import { useNodeDetail } from '../api/queries';

/** 供测试与回执引用的空关卡提示句。 */
export const NO_LEVEL_HINT = '还没有关卡，说一句让我生成';

export interface NowLearningCardProps {
  /** 当前知识点 id；调用方只在该有值时挂这张卡 */
  microKpId: string;
  /** 解析链算好的名字（调用方传，卡内不重复解析） */
  microKpName: string;
}

export function NowLearningCard({ microKpId, microKpName }: NowLearningCardProps) {
  const navigate = useNavigate();
  const { payload } = useNodeDetail(microKpId);
  const level = payload?.levels[0];
  const pageLabel = payload?.source?.pageLabel;
  /*
   * 票 08：章节路径是来源行的主形态。join(' · ') 只在这里拼一次——
   * 分隔符是前端文案，将来换行宽想改「、」或换行，改这一处。
   */
  const ancestors = payload?.ancestors;
  const pathLine = ancestors && ancestors.length > 0 ? ancestors.join(' · ') : null;

  return (
    <Card className="sm-glass sm-study-card" data-study-now>
      <Text weight="semibold" as="h3">
        正在学
      </Text>
      {/* mockup 里名字是这张卡的主文（16px 半粗），比 Caption 系的说明行重一档 */}
      <Text weight="semibold" className="sm-study-kp">
        {microKpName}
      </Text>
      {/*
       * 来源行两态（票 08）：有章节路径 → 「章 · 节」为主行、书名页码整句
       * 降为悬浮；没有路径但有 source → 沿用 pageLabel 行。两样都没有
       * （手工知识点）不渲染，详情在路上时也不渲染——占位句子会比晚到的
       * 真句子更吵。
       */}
      {pathLine ? (
        <Caption1 className="sm-study-kp" title={pageLabel ?? undefined}>
          {pathLine}
        </Caption1>
      ) : pageLabel ? (
        <Caption1 className="sm-study-kp">{pageLabel}</Caption1>
      ) : null}
      {/*
       * 详情没回来前关卡位留空（既不出按钮也不出「还没有关卡」——
       * 那句话在有关卡的知识点上会闪一下然后变成按钮，像撤回说过的话）。
       */}
      {payload === undefined ? null : level ? (
        <Button
          size="small"
          appearance="secondary"
          onClick={() => navigate(`/level/${encodeURIComponent(level.levelId)}`)}
        >
          打开关卡
        </Button>
      ) : (
        <Caption1 className="sm-study-note">{NO_LEVEL_HINT}</Caption1>
      )}
      {/* 票 07（按名字/页码搜索）落地前，「去地图选」是唯一的切换入口 */}
      <Button size="small" appearance="subtle" onClick={() => navigate('/map')}>
        去地图选
      </Button>
    </Card>
  );
}
