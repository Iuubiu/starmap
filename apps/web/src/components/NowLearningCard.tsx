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
 * 两样：`source.pageLabel`（服务端拼好的整句，前端不拼「书名 · 页码」）
 * 与 `levels`（关卡入口）。与页面已有的同名请求共用 react-query 缓存，
 * 不会发两次。
 *
 * ## 关卡入口的两态
 *
 * `levels` 非空 → 「打开关卡」跳 `/level/:levelId`（取第一个，与
 * `HomePage` 算 `focusedLevelId` 的口径一致）；空 → 只提示
 * 「还没有关卡，说一句让我生成」—— **不自动生成**：生成是一次昂贵的
 * 服务端动作，入口在学习者自己嘴里，替他点下去就是替他做了决定。
 *
 * 无 source 的手工知识点（kp-bool 等 3 个）没有 `source` 字段：来源行
 * 降级为整行不渲染，不是渲染「来源：—」——「—」会让人以为有一本没读到
 * 的书，而真相是这本就是手工写的示例点。
 */
import { Button, Caption1, Card, Text } from '@fluentui/react-components';
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
       * 来源行只在有 source 时渲染（手工知识点降级为空）。
       * 详情还在路上时也不渲染：占位句子会比晚到的真句子更吵。
       */}
      {pageLabel ? <Caption1 className="sm-study-kp">{pageLabel}</Caption1> : null}
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
