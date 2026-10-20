import {
  Text,
  Body1,
  Spinner,
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
  Card,
  CardHeader,
  Badge,
  Button,
  Divider,
} from '@fluentui/react-components';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useMastery, useNodeDetail, useNodeUnlock } from '../api/queries';
import { MasteryMeter } from '../level/MasteryMeter';
import { masteryLabel } from '../mastery/labels';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '860px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  heading: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  reasons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  levelList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  /**
   * Fluent 的 Badge 会按容器宽度折行，中文在窄容器里会变成一列竖排字。
   * 关卡类型是短标签，不该换行 —— 这个 bug 是截图才看出来的，单测抓不到。
   */
  kindBadge: {
    whiteSpace: 'nowrap',
  },
  unlockCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  blockerLinks: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  levelActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
});

/**
 * 状态词表已移到 `../mastery/labels`（前端唯一一份）。这里原来那份的表里
 * **缺 `attempted`**，却多了一个契约里根本不存在的 `unfamiliar` —— 于是后端真发
 * `attempted` 时，页面上直接显示英文原值 `attempted`。这类缺陷只在恰好遇到那个
 * 状态时出现，所以把它收进 `Record<MasteryState, string>` 让 typecheck 提醒。
 */
const KIND_LABEL: Record<string, string> = {
  teach: '教学关卡',
  quiz: '题目关卡',
  review: '复验关卡',
};

/**
 * 知识点详情页。
 *
 * 掌握度显示**两个**数字而不是一个（D2）：`achieved` 不衰减、用于解锁，
 * `current` 会衰减、用于推荐。用户看到的是 `current`，因为它更接近
 * 「现在还能不能做对」；但门控判定用 `achieved`，所以两个都要能看见。
 *
 * 证据不足时显示「证据不足」而不是 0% —— 0% 是「做了且全错」，
 * 两者对学习者的含义完全不同。
 */
export function NodeDetailPage() {
  const styles = useStyles();
  const { microKpId } = useParams<{ microKpId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const node = useNodeDetail(microKpId);

  /**
   * 回地图的地址（票 03 第 4 条：从关卡返回时焦点保持原位）。
   *
   * 两级回落，因为到达这个页面的路径不止一条：
   *
   * 1. `location.state.returnHref` —— 从图谱点进来时 `MapPage` 已经拼好了
   *    完整地址（带 `focus` / `hops` / `view`）。原样用，位置分毫不差。
   * 2. 没有 state 时（直接打开链接、从看板进来、刷新页面）用当前节点当焦点。
   *    这仍然满足「回到地图时以刚才看的节点为中心」，只是跳数与视图用默认。
   *
   * 绝不回落到裸 `/map`：那会退到全图，而「我刚看完的那个点在哪」正是用户
   * 按下这个按钮时唯一想知道的事。
   */
  const backToMap = (): void => {
    const state = location.state as { returnHref?: unknown } | null;
    const fromState = state?.returnHref;
    if (typeof fromState === 'string' && fromState.startsWith('/map')) {
      navigate(fromState);
      return;
    }
    const id = microKpId ?? node.payload?.node.microKpId;
    navigate(id ? `/map?${new URLSearchParams({ focus: id, hops: '2' }).toString()}` : '/map');
  };

  /**
   * 掌握度的真源是 `/mastery/{microKpId}`，不是节点详情里的 `percent`。
   *
   * 原因是两者算的不是一回事：节点详情里的 `percent` 是 `app.mastery.current`
   * 这一列的**快照**（上一次作答那一刻写下的值，之后不再更新）；而 mastery 接口
   * 每次请求都从 `attempts` 重放证据、按半衰期重新算一遍。展示一个会随时间变旧的
   * 数，等于要求用户理解「你看的这个数是几天前算的」——没有人会去理解这件事，
   * 他们只会记住它，然后被它误导。
   */
  const mastery = useMastery(microKpId ?? node.payload?.node.microKpId);

  /**
   * 这个知识点解锁了没有（票 06 验收 3：前端要能看出「为什么还没解锁」）。
   *
   * 单独一个接口而不是塞进节点详情：解锁状态会在「通过门控」那一刻变，而节点详情
   * 是静态内容。两者生命周期不同，合在一起就要么缓存了旧锁、要么每次翻页都重拉内容。
   */
  const unlock = useNodeUnlock(microKpId ?? node.payload?.node.microKpId);

  if (node.isPending) return <div className={styles.page}><Spinner label="加载知识点…" /></div>;

  if (node.isError || !node.payload) {
    return (
      <div className={styles.page}>
        <MessageBar intent="error">
          <MessageBarBody>
            无法读取该知识点：{node.error instanceof Error ? node.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
        <div>
          <Button onClick={backToMap}>返回地图</Button>
        </div>
      </div>
    );
  }

  const { node: kp, levels, reasons } = node.payload;

  /**
   * 锁着就不让进关（票 06）。
   *
   * 判定用 `unlocked === false` 而不是 `!unlocked`：接口还没回来时 `payload`
   * 是 `undefined`，那是「还不知道」而不是「锁着」。把未知当锁着会让页面在
   * 首帧短暂禁用所有按钮，然后突然放开 —— 那种闪烁会让人以为自己看错了。
   */
  const locked = unlock.payload?.unlocked === false;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          {kp.name}
        </Text>
        <Body1>
          层级深度 {kp.depth} · 当前状态 {masteryLabel(kp.state)}
        </Body1>
      </div>

      <Card>
        <CardHeader header={<Text weight="semibold">掌握度</Text>} />
        {/*
          双字段（票 05 验收 5）：`achieved` 不衰减、管解锁；`current` 衰减、管推荐。
          证据不足时两栏都不给数字 —— 显示 0% 等于告诉学习者「你完全不会」，
          而系统此刻其实只是「还不知道」。细节与措辞都在 MasteryMeter 里。
        */}
        <MasteryMeter view={mastery.payload} />
      </Card>

      {reasons.length > 0 && (
        <Card>
          <CardHeader header={<Text weight="semibold">为什么推荐这个知识点</Text>} />
          <div className={styles.reasons}>
            {reasons.map((reason, i) => (
              <Body1 key={i}>· {reason}</Body1>
            ))}
          </div>
        </Card>
      )}

      <Divider />
      <Text weight="semibold">可用关卡</Text>

      {/*
        未解锁时先讲清「被哪几道门挡着、各差几题」（票 06 验收 3）。
        这段要放在关卡列表**之前**：若只把每张关卡卡片的按钮置灰，学习者会先
        点一遍全部关卡、看到一片「进不去」，才知道自己少做了什么。
      */}
      {unlock.payload && !unlock.payload.unlocked && (
        <Card className={styles.unlockCard}>
          <CardHeader
            header={<Text weight="semibold">这个知识点还没解锁</Text>}
            action={
              <Badge appearance="tint" color="warning" className={styles.kindBadge}>
                先修门未通过
              </Badge>
            }
          />
          <Body1>先学完并通过下面这几道先修门，这里才会开放：</Body1>
          <div className={styles.reasons}>
            {unlock.payload.blockers.map((blocker) => (
              <Body1 key={blocker.prerequisiteId}>
                ·「{blocker.prerequisiteName}」
                {blocker.levelTitle ? `《${blocker.levelTitle}》` : ''}
                {blocker.gateMode === 'exit' ? '（章末出口）' : '（高入度先修）'}
                {blocker.lastVerdict === null
                  ? '：还没考过它的出口测试'
                  : blocker.lastVerdict === 'passed'
                    ? '：最近一次已达标，等待解锁记上'
                    : `：最近一次还差 ${blocker.shortfall ?? 0} 道题`}
              </Body1>
            ))}
          </div>
          {unlock.payload.blockers.some((blocker) => blocker.levelId !== null) && (
            <div className={styles.blockerLinks}>
              {unlock.payload.blockers
                .filter((blocker) => blocker.levelId !== null)
                .map((blocker) => (
                  <Button
                    key={blocker.prerequisiteId}
                    appearance="secondary"
                    onClick={() => navigate(`/level/${blocker.levelId}`)}
                  >
                    去考「{blocker.prerequisiteName}」的出口测试
                  </Button>
                ))}
            </div>
          )}
        </Card>
      )}

      {levels.length === 0 ? (
        <MessageBar>
          <MessageBarBody>这个知识点还没有关卡。运行内容入库（票 02）后会生成。</MessageBarBody>
        </MessageBar>
      ) : (
        <div className={styles.levelList}>
          {levels.map((level) => (
            <Card key={level.levelId}>
              <CardHeader
                header={<Text weight="semibold">{level.title}</Text>}
                description={
                  <Body1>
                    {KIND_LABEL[level.kind] ?? level.kind} · {level.itemCount} 道题
                  </Body1>
                }
                action={
                  <div className={styles.levelActions}>
                    <Badge appearance="outline" className={styles.kindBadge}>
                      {KIND_LABEL[level.kind] ?? level.kind}
                    </Badge>
                    {/*
                      入口按钮只在已解锁时可点。**不是靠禁用按钮表达「为什么」** ——
                      原因写在上面的障碍卡里（有段落、有还差几题、有直达链接），
                      一个灰按钮说不出任何理由。
                    */}
                    <Button
                      appearance="primary"
                      disabled={locked}
                      onClick={() => navigate(`/level/${encodeURIComponent(level.levelId)}`)}
                    >
                      {locked ? '未解锁' : '开始'}
                    </Button>
                  </div>
                }
              />
            </Card>
          ))}
        </div>
      )}

      <div>
        <Button onClick={backToMap}>返回地图</Button>
      </div>
    </div>
  );
}
