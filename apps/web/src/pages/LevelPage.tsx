/**
 * 关卡播放页 `/level/:levelId` —— 票 04 的落点。
 *
 * 页面只做三件事：取 spec、把当前段渲染出来、把作答与推进交给 `./level/flow`
 * 这个纯状态机。所有业务规则（什么时候跳过深究、哪些段不计分、反馈从哪来）
 * 都在状态机里且被单测覆盖，组件里不写第二份。
 *
 * 为什么不在这里做「进度保存」：票 05 会把作答落进 `attempts` 表，届时进度
 * 的真源是后端。现在若先在 localStorage 里存一份，接上后端时必然要对两份
 * 状态做合并，而合并规则永远比想象中难。宁可现在刷新即重来。
 */
import { useMemo, useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Card,
  CardHeader,
  Divider,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router';
import { useLevel } from '../api/queries';
import type { LevelSpec } from '../api/queries';
import {
  STEP_KIND_LABEL,
  advance,
  correctCountInStep,
  countedRecordCount,
  createFlow,
  currentStep,
  feedbackFor,
  inRemediation,
  isStepComplete,
  masteryTotal,
  stepProgress,
  submitAnswer,
} from '../level/flow';
import type { FlowState } from '../level/flow';
import { CardView } from '../level/CardView';
import { QuestionView } from '../level/QuestionView';
import { StepRail } from '../level/StepRail';
import { RichText } from '../level/markdown';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '880px',
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
  titleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  footer: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
    position: 'sticky',
    bottom: 0,
    padding: '14px 0',
    background: tokens.colorNeutralBackground1,
  },
  summaryCard: {
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  statRow: {
    display: 'flex',
    gap: '32px',
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
  },
  centered: {
    display: 'flex',
    justifyContent: 'center',
    padding: '64px',
  },
  message: {
    maxWidth: '560px',
    margin: '64px auto',
  },
});

export function LevelPage() {
  const styles = useStyles();
  const { levelId } = useParams<{ levelId: string }>();
  const navigate = useNavigate();
  const { payload, isLoading, error } = useLevel(levelId);
  const [flow, setFlow] = useState<FlowState>(() => createFlow());

  const spec = payload?.spec;

  if (isLoading) {
    return (
      <div className={styles.centered}>
        <Spinner label="正在载入关卡…" />
      </div>
    );
  }

  if (error || !payload || !spec) {
    return (
      <div className={styles.message}>
        <MessageBar intent="error">
          <MessageBarBody>
            关卡载入失败：{error instanceof Error ? error.message : '关卡不存在或规范不合法'}
          </MessageBarBody>
        </MessageBar>
      </div>
    );
  }

  return (
    <LevelPlayer
      key={spec.meta.id}
      spec={spec}
      levelKind={payload.level.kind}
      flow={flow}
      setFlow={setFlow}
      onExit={() => navigate(`/map/${payload.level.microKpId}`)}
    />
  );
}

interface LevelPlayerProps {
  spec: LevelSpec;
  levelKind: string;
  flow: FlowState;
  setFlow: (next: FlowState) => void;
  onExit: () => void;
}

const KIND_LABEL: Record<string, string> = {
  teach: '教学关卡',
  quiz: '题目关卡',
  mixed: '混合关卡',
};

function LevelPlayer({ spec, levelKind, flow, setFlow, onExit }: LevelPlayerProps) {
  const styles = useStyles();
  const progress = useMemo(() => stepProgress(spec, flow), [spec, flow]);
  const step = currentStep(spec, flow);

  const cards = step ? step.cardIds.map((cardId) => spec.cards.find((c) => c.id === cardId)) : [];
  const items = step ? step.itemIds.map((itemId) => spec.items.find((i) => i.id === itemId)) : [];
  const complete = step ? isStepComplete(flow, step) : false;
  const correct = step ? correctCountInStep(flow, step) : 0;
  const remediating = inRemediation(step);

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div className={styles.titleRow}>
          <Text className={styles.title} as="h1">{spec.meta.title}</Text>
          <Badge appearance="tint" color="brand" style={{ whiteSpace: 'nowrap' }}>
            {KIND_LABEL[levelKind] ?? levelKind}
          </Badge>
          <Badge appearance="outline" style={{ whiteSpace: 'nowrap' }}>
            {spec.meta.tier} · 约 {spec.meta.estimatedMinutes} 分钟
          </Badge>
        </div>
        <Text className={styles.subtitle}>
          知识点 {spec.meta.microKpId} · 共 {spec.steps.length} 段
        </Text>
      </header>

      <StepRail progress={progress} />

      {remediating && (
        <MessageBar intent="warning">
          <MessageBarBody>
            这一段是<strong>深究</strong>：它只想把你脑子里的错误规则挖出来，所以
            <strong>全程不扣掌握度</strong>，答错也没有代价。放开答。
          </MessageBarBody>
        </MessageBar>
      )}

      <Divider />

      {/**
       * 小结段直接渲染结算面板，不再单列一次「小结卡 + 下一段按钮」。
       *
       * 原来小结段先显示卡片与「完成本关」按钮，点完再叠一层总结；同一张
       * 小结卡会出现两次，学习者看到的是「又说了一遍」。流程上小结就是终点，
       * 让 `summary` 段本身承载结算界面，路径最短。
       */}
      {flow.finished || step?.kind === 'summary' ? (
        <SummaryPanel
          spec={spec}
          flow={flow}
          onExit={onExit}
        />
      ) : (
        step && (
          <>
            <div className={styles.sectionHeader}>
              <Text className={styles.sectionTitle}>
                第 {flow.stepIndex + 1} 段 · {STEP_KIND_LABEL[step.kind]}
              </Text>
              <Badge appearance="outline" style={{ whiteSpace: 'nowrap' }}>
                {step.title}
              </Badge>
            </div>

            <div className={styles.section}>
              {cards.map((card) => (card ? <CardView key={card.id} card={card} /> : null))}
            </div>

            {items.length > 0 && (
              <div className={styles.section}>
                {items.map((item) => {
                  if (!item) return null;
                  const choice = flow.choices[item.id];
                  // 有选择值 = 已提交。反馈从状态机的记录重建，刷新重渲染也拿到同一条。
                  const submitted =
                    choice === undefined
                      ? undefined
                      : { choice, feedback: feedbackFor(spec, flow, item.id) };
                  return (
                    <QuestionView
                      key={item.id}
                      item={item}
                      submitted={submitted}
                      onSubmit={(value) => setFlow(submitAnswer(spec, flow, item.id, value).state)}
                      nonScoring={remediating}
                    />
                  );
                })}
              </div>
            )}

            <div className={styles.footer}>
              <Button
                appearance="primary"
                onClick={() => setFlow(advance(spec, flow))}
                disabled={!complete}
              >
                进入下一段
              </Button>
              {!complete && step.itemIds.length > 0 && (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  本段还有题没答（已答对 {correct} 道），答完才能继续
                </Text>
              )}
              {complete && step.itemIds.length === 0 && (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  看完这段就可以继续
                </Text>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}

/** 小结段：把这一关的证据摊开，并给出「下一关 / 回知识点」的出口。 */
function SummaryPanel({
  spec,
  flow,
  onExit,
}: {
  spec: LevelSpec;
  flow: FlowState;
  onExit: () => void;
}) {
  const styles = useStyles();
  const navigate = useNavigate();
  const total = flow.records.length;
  const correct = flow.records.filter((record) => record.correct).length;
  const counted = countedRecordCount(flow);
  const mastery = masteryTotal(flow);
  const reteachCards = spec.steps
    .filter((entry) => entry.kind === 'summary')
    .flatMap((entry) => entry.cardIds)
    .map((cardId) => spec.cards.find((card) => card.id === cardId))
    .filter((card): card is NonNullable<typeof card> => card !== undefined);

  return (
    <>
      <div className={styles.sectionHeader}>
        <Text className={styles.sectionTitle}>本关小结</Text>
        <Badge
          appearance="tint"
          color={flow.tookRemediation ? 'informative' : 'success'}
          style={{ whiteSpace: 'nowrap' }}
        >
          {flow.tookRemediation ? '走了深究路径' : '一次通过'}
        </Badge>
      </div>

      <div className={styles.section}>
        {reteachCards.map((card) => (
          <CardView key={card.id} card={card} />
        ))}

        <Card className={styles.summaryCard} appearance="filled">
          <CardHeader header={<Text className={styles.sectionTitle}>本关证据</Text>} />
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>作答</span>
              <span className={styles.statValue}>{total}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>答对</span>
              <span className={styles.statValue}>{correct}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>计入掌握度</span>
              <span className={styles.statValue}>{counted}</span>
            </div>
          </div>
          <Body1>
            {flow.tookRemediation
              ? '这一趟走了深究路径。深究与进一步讲解里的作答不计入掌握度，' +
                `所以真正计入的是 ${counted} 道，掌握度记分合计 ${mastery}。`
              : `一次通过，${counted} 道作答全部计入掌握度，记分合计 ${mastery}。`}
          </Body1>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            掌握度是否真正达标由后端按 BKT 判定（票 05）；这里只展示本次会话的原始证据。
          </Text>
        </Card>
      </div>

      <div className={styles.footer}>
        {spec.meta.nextLevelId !== null ? (
          <Button appearance="primary" onClick={() => navigate(`/level/${spec.meta.nextLevelId}`)}>
            进入下一关
          </Button>
        ) : (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            这是当前知识点最后一关
          </Text>
        )}
        <Button appearance="secondary" onClick={onExit}>
          回到知识点
        </Button>
      </div>
    </>
  );
}
