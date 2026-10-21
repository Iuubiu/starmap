/**
 * 出口门控面板（票 06）。
 *
 * ## 为什么是「主动考一次」而不是自动判定
 *
 * 验收 4 要求关内单次答错不算门控失败。若每提交一题就判一次，学习者会在第 3 题
 * 答错的那一刻看到「不及格」，而那时他才刚开始这一关 —— 这不是反馈，是劝退。
 * 所以判定是一个**显式动作**：走完全程、看到小结，自己决定什么时候考。
 *
 * ## 为什么 `undetermined` 单独一档
 *
 * 「题量不足」既不是通过也不是不通过。把它画成红色会让学习者以为自己做错了，
 * 画成绿色则是撒谎。它只说明「还没考够」，界面就该说「还差 3 道没做」。
 *
 * ## 为什么重讲路径要念出答错的题
 *
 * 验收 3 要的是「指向具体的缺哪块」，不是一句「不合格」。后端的 `remediation`
 * 已经带上了 `message` 与被答错题干的摘要；这里再把题目逐条列出来（点得着的
 * 位置信息），学习者才知道回去该重听哪一段、重做哪几道。
 */
import {
  Badge,
  Body1,
  Button,
  Card,
  CardHeader,
  MessageBar,
  MessageBarBody,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type {
  GateEvaluation,
  GateHistoryResponse,
  LevelSpec,
  UnlockState,
} from '../api/queries';

const useStyles = makeStyles({
  card: {
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  headRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  badge: {
    whiteSpace: 'nowrap',
  },
  numbers: {
    display: 'flex',
    gap: '28px',
    flexWrap: 'wrap',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  statValue: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: tokens.lineHeightHero800,
  },
  remediate: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 14px',
    background: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  mono: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: tokens.lineHeightBase300,
  },
  wrong: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteDarkOrangeForeground1,
    lineHeight: tokens.lineHeightBase300,
  },
  actions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  history: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
});

const VERDICT_LABEL: Record<GateEvaluation['verdict'], string> = {
  passed: '已通过',
  failed: '未通过',
  undetermined: '还没考够',
};

/**
 * 引擎的出口 / 先修门控规则（题量下限 + 该题量下的达标线）。
 *
 * ## 为什么前端要抄一份
 *
 * **未判定时不能显示 spec 里的 `gating.itemCount` / `gating.passCount`。**
 * `ruleFor()`（`apps/api/src/gating/gating.service.ts` 的 `export function ruleFor`）
 * 对 `exit` / `prereq`
 * 一律返回引擎的 `GATE_RULES[mode]`，作者在 spec 里写的数值**根本不参与判定**
 * —— 它只被校验器用来保证卷子够长。若这里显示作者值，学习者会按一个不会生效的
 * 数字准备考试：作者写 20 题，他做满 20 题，而判定从第 8 题就开始算，达标线还是
 * 按 8 题的下界。一个考前就错、考后还要自相矛盾的数字，比不给数字更糟。
 *
 * ## 为什么不 import `@starmap/engine`
 *
 * `apps/web` 不依赖 engine（`.dependency-cruiser.cjs` 的边界，且浏览器侧只该拿到
 * 契约生成的类型）。所以这两个数在这里重述一遍 —— 与 `MasteryMeter.tsx` 的
 * `MIN_ATTEMPTS` / `MIN_VARIANTS` 同一手法。`GatePanel.test.tsx` 有一条用例读
 * `packages/engine/src/gating.ts` 比对，两边漂移会立刻红。
 *
 * ## 为什么只固定「下限」而不固定整张表
 *
 * 判定用的达标线随**实际题量**变化（`requiredCorrectFor` 的二项下界）：8 题需 7
 * 对、10 题需 9 对、20 题需 16 对。考前不知道学习者会做多少题，所以只能显示
 * 「最低题量 + 该题量下的达标线」；做多了之后以 `evaluation.rule` 为准。
 */
export const GATE_MIN_RULE: Record<
  'exit' | 'prereq',
  { itemCount: number; passCount: number }
> = {
  exit: { itemCount: 8, passCount: 7 },
  prereq: { itemCount: 10, passCount: 9 },
};

/**
 * 这一关实际会被门控考到几道题。
 *
 * 与后端 `gateItemIds()` 同口径：先取 `quiz` 段引用的题，没有则回退到
 * `pool:'core'` 的题，再回退到全部。抄这个口径而不是大致估一下，是因为它要被
 * 用来判断「这一关的题量撑不撑得起门控」—— 口径偏一点，警告就会误报或漏报。
 */
function gateItemCount(spec: LevelSpec): number {
  const referenced = new Set<string>();
  for (const step of spec.steps) {
    if (step.kind !== 'quiz') continue;
    for (const itemId of step.itemIds) referenced.add(itemId);
  }
  if (referenced.size > 0) return spec.items.filter((item) => referenced.has(item.id)).length;
  const core = spec.items.filter((item) => item.pool === 'core');
  return core.length > 0 ? core.length : spec.items.length;
}

const VERDICT_COLOR: Record<
  GateEvaluation['verdict'],
  'success' | 'warning' | 'informative'
> = {
  passed: 'success',
  failed: 'warning',
  undetermined: 'informative',
};

/** 门控模式的对外说法。全中文，别把枚举值漏到界面上。 */
export const GATE_MODE_LABEL: Record<string, string> = {
  none: '不设门控',
  exit: '章末出口',
  prereq: '高入度先修',
};

function stemOf(spec: LevelSpec, itemId: string): string {
  const item = spec.items.find((entry) => entry.id === itemId);
  if (!item) return itemId;
  const text = item.stem.replace(/\s+/g, ' ').trim();
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

function formatTime(iso: string): string {
  // 只显示到分钟：判定是「哪一天考的」这件事比秒更重要，秒会让列表变噪音。
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export interface GatePanelProps {
  spec: LevelSpec;
  evaluation: GateEvaluation | undefined;
  /** 本次判定新解锁的下游节点。历史解锁不会重复出现，所以只看这一份。 */
  unlockedNodeIds: string[];
  history: GateHistoryResponse | undefined;
  isEvaluating: boolean;
  /** mutation 的错误；409 已在页面层转成锁面板，这里只负责其余错误。 */
  error: unknown;
  onEvaluate: () => void;
  /** 把这一关重走一遍。已记进档案的作答不会丢 —— 重做只是产生新证据。 */
  onRestart: () => void;
}

export function GatePanel({
  spec,
  evaluation,
  unlockedNodeIds,
  history,
  isEvaluating,
  error,
  onEvaluate,
  onRestart,
}: GatePanelProps) {
  const styles = useStyles();
  const mode = spec.gating.mode;

  // 不设门控的关卡：说清楚「这里没有门槛」，而不是画一个永远灰着的按钮。
  if (mode === 'none') {
    return (
      <Card className={styles.card} appearance="outline">
        <CardHeader
          header={<Text weight="semibold">出口门控</Text>}
          action={
            <Badge appearance="outline" className={styles.badge}>
              {GATE_MODE_LABEL.none}
            </Badge>
          }
        />
        <Body1>
          这一关不设门控：关内允许自由尝试，答错不会挡住你。硬门槛只设在章末出口与高入度先修节点上。
        </Body1>
      </Card>
    );
  }

  // 阈值口径：**未判定时用引擎规则的题量下限，判定后用评估快照里的实际生效值**。
  //
  // 两处都不能读 `spec.gating`：作者的声明值不参与判定（理由见 GATE_MIN_RULE）。
  // 判定后读 `evaluation.rule` 是唯一正确的来源 —— 它是 `appliedThreshold(rule,
  // total)` 的产物，记的是「这一次实际按什么线判的」。把它换成 spec 值会让
  // 「答对 12/20、达标线写着 7/8」这种自相矛盾的组合重新出现。
  const rule = evaluation?.rule ?? GATE_MIN_RULE[mode];
  const gateItems = gateItemCount(spec);
  const shortOfItems = gateItems < rule.itemCount;
  const wrong = evaluation ? evaluation.wrongItemIds : [];
  const historyEntries = history?.evaluations ?? [];

  return (
    <Card className={styles.card} appearance="outline">
      <CardHeader
        header={<Text weight="semibold">出口门控</Text>}
        action={
          <Badge appearance="outline" className={styles.badge}>
            {GATE_MODE_LABEL[mode] ?? mode}
          </Badge>
        }
      />

      {!evaluation && (
        <>
          <Body1>
            这一关是{GATE_MODE_LABEL[mode] ?? mode}：判定题至少要做满 {rule.itemCount} 道，
            这时要答对 {rule.passCount} 道才算过。做得更多时达标线会按实际题量重算 ——
            题量越多，允许的错题比例越接近两成，所以它不是固定分数。
          </Body1>
          <Body1>
            这条线由判定规则决定，不读关卡里声明的题量：判定只读这一关里计入掌握度的
            作答，所以深究与进一步讲解里答的题不算成绩，答错也不会拖累这里。
          </Body1>
          {shortOfItems && (
            <MessageBar intent="warning">
              <MessageBarBody>
                这一关的判定段只有 {gateItems} 道题，少于门控要求的 {rule.itemCount} 道 ——
                判定会一直是「还没考够」，不可能通过。这是关卡内容的问题，不是你的问题。
              </MessageBarBody>
            </MessageBar>
          )}
        </>
      )}

      {evaluation && (
        <>
          <div className={styles.headRow}>
            <Badge
              appearance="tint"
              color={VERDICT_COLOR[evaluation.verdict]}
              className={styles.badge}
            >
              {VERDICT_LABEL[evaluation.verdict]}
            </Badge>
            <Text>{evaluation.message}</Text>
          </div>

          <div className={styles.numbers}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>答对</span>
              <span className={styles.statValue}>{evaluation.correct}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>做了</span>
              <span className={styles.statValue}>{evaluation.total}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>达标线</span>
              <span className={styles.statValue}>
                {evaluation.rule.passCount}/{evaluation.rule.itemCount}
              </span>
            </div>
            {evaluation.verdict !== 'passed' && (
              <div className={styles.stat}>
                <span className={styles.statLabel}>还差</span>
                <span className={styles.statValue}>{evaluation.shortfall}</span>
              </div>
            )}
          </div>

          {evaluation.verdict === 'passed' && unlockedNodeIds.length > 0 && (
            <MessageBar intent="success">
              <MessageBarBody>
                刚解锁了 {unlockedNodeIds.length} 个下游节点：
                {unlockedNodeIds.join('、')}。刷新页面也不会丢 —— 解锁是存在库里的状态，
                不是这一次请求的回执。
              </MessageBarBody>
            </MessageBar>
          )}

          {evaluation.verdict === 'passed' && unlockedNodeIds.length === 0 && (
            <Body1>
              这次没有新解锁的下游节点：要么之前就解锁过了，要么这个知识点的下游还没有内容。
              判定记录已留下，解锁状态在库里，刷新不会变。
            </Body1>
          )}

          {evaluation.remediation && (
            <div className={styles.remediate}>
              <Text weight="semibold">接下来重听哪一块</Text>
              {evaluation.remediation.stepTitle && (
                <Text className={styles.mono}>
                  对应段落：{evaluation.remediation.stepTitle}
                  {evaluation.remediation.stepId ? `（${evaluation.remediation.stepId}）` : ''}
                </Text>
              )}
              <Body1>{evaluation.remediation.message}</Body1>
              {wrong.length > 0 && (
                <div className={styles.itemList}>
                  <span className={styles.wrong}>这次答错的题：</span>
                  {wrong.map((itemId) => (
                    <span key={itemId} className={styles.wrong}>
                      · {stemOf(spec, itemId)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={styles.itemList}>
            <span className={styles.mono}>
              这次判定用了这 {evaluation.itemIds.length} 道题（记在判定当时，之后改内容也不会变）：
            </span>
            {evaluation.itemIds.map((itemId) => (
              <span key={itemId} className={wrong.includes(itemId) ? styles.wrong : styles.mono}>
                {wrong.includes(itemId) ? '· 答错：' : '· 答对：'}
                {stemOf(spec, itemId)}
              </span>
            ))}
          </div>
        </>
      )}

      {error !== undefined && error !== null && (
        <MessageBar intent="error">
          <MessageBarBody>
            判定没能完成：{error instanceof Error ? error.message : '未知错误'}
            。这次没有写下任何判定记录。
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.actions}>
        <Button appearance="primary" onClick={onEvaluate} disabled={isEvaluating}>
          {isEvaluating ? '正在判定…' : evaluation ? '再评一次' : '评一次出口门控'}
        </Button>
        <Button appearance="secondary" onClick={onRestart} disabled={isEvaluating}>
          重走这一关
        </Button>
        {!evaluation && (
          <Text className={styles.mono}>
            会拿这一关已记进档案的作答来算；没做够 {rule.itemCount} 道会判「还没考够」。
          </Text>
        )}
      </div>

      {historyEntries.length > 1 && (
        <div className={styles.history}>
          <Text weight="semibold">历次判定（新的在前）</Text>
          {historyEntries.map((entry) => (
            <span key={`${entry.evaluatedAt}-${entry.correct}`} className={styles.mono}>
              {formatTime(entry.evaluatedAt)} · 答对 {entry.correct}/{entry.total} ·{' '}
              {VERDICT_LABEL[entry.verdict]} · 用了 {entry.itemIds.length} 道题 ·{' '}
              {/* 达标线取这条**历史记录自己**的 rule，不是当前的、也不是 spec 的：
                  题量改过之后回看，要看到当时按什么线判的，否则「当年为什么没过」
                  会被今天的数字重新解释一遍。 */}
              达标线 {entry.rule.passCount}/{entry.rule.itemCount}
              {entry.verdict === 'passed' ? '' : ` · 还差 ${entry.shortfall} 道`}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * 未解锁（409）时的说明面板。
 *
 * 不说「禁止访问」，说「先过哪一关」。学习者永远需要一个下一步动作；
 * 一个只有错误的页面等于把人赶走。
 */
export function LockedNotice({
  state,
  onBack,
  onRetry,
}: {
  state: UnlockState;
  onBack: () => void;
  onRetry?: () => void;
}) {
  const styles = useStyles();
  return (
    <Card className={styles.card}>
      <CardHeader
        header={<Text weight="semibold">这一关还没解锁</Text>}
        action={
          <Badge appearance="tint" color="warning" className={styles.badge}>
            先修门未通过
          </Badge>
        }
      />
      <Body1>
        这个知识点要先学完并过了它的先修门，才会开放。挡在前面的有 {state.blockers.length} 道门：
      </Body1>
      <div className={styles.itemList}>
        {state.blockers.map((blocker) => (
          <span key={blocker.prerequisiteId} className={styles.mono}>
            ·「{blocker.prerequisiteName}」
            {blocker.levelTitle ? `《${blocker.levelTitle}》` : ''}
            {blocker.lastVerdict === null
              ? '：还没考过它的出口测试'
              : blocker.lastVerdict === 'passed'
                ? '：最近一次判定已达标，但解锁还没记上'
                : `：最近一次判定还差 ${blocker.shortfall ?? 0} 道题`}
          </span>
        ))}
      </div>
      <div className={styles.actions}>
        <Button appearance="primary" onClick={onBack}>
          回到知识点
        </Button>
        {onRetry && (
          <Button appearance="secondary" onClick={onRetry}>
            重新检查
          </Button>
        )}
      </div>
    </Card>
  );
}
