/**
 * 关卡模板面板（票 67）：选模板 + 选知识点 + 选档位 → 预览 → 保存。
 *
 * ## 为什么预览要「真渲染一张关卡卡」而不是列几个数字
 *
 * 验收②的原话是「右侧按模板渲染出**真实关卡预览卡**（段名、题数、首段形态、
 * 难度档徽章），与直接进关卡看到的首屏一致」。列「7 段 12 题」也能说明骨架，
 * 但学习者真正想知道的是「点进去长什么样」—— 段名对不对、第一段是看讲解还是
 * 直接做题、题干是不是空的。所以这里把服务端填出来的草稿**按段渲染**，与
 * `LevelPage` 的首屏用同一份 spec 数据（不是另造一份展示模型）。
 *
 * ## 为什么不 import `apps/web/src/level/**` 的组件
 *
 * `StepRail` / `CardView` 是播放器的一部分（票 67 的 outOfScope）。预览只读
 * 不写，复用它们会把「预览」和「播放」的生命周期绑在一起：播放器改一次
 * 段标题渲染，预览的测试就要跟着改。这里自己画一遍，代价是十几行 JSX，
 * 收益是两边可以各自演化。
 *
 * ## 档位为什么不写死数值
 *
 * `@starmap/engine` 不在 web 的依赖图里（`.dependency-cruiser.cjs` 的
 * `engine-no-apps`），`TIER_PARAMS` 的数值必须从 `GET /api/v1/tier` 投影读。
 * 但**模板骨架**是另一回事：段过滤发生在服务端（`fillLevelTemplate` 按
 * `segment.tiers.includes(tier)` 过滤），前端只需要知道「三档分别是哪三档」。
 * 所以这里只枚举 `P1|P2|P3`，档位的**行为说明**来自 tier hook。
 */
import { useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Card,
  CardHeader,
  Divider,
  Dropdown,
  Field,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type {
  LevelTemplateListResponseTemplatesItem,
  LevelTemplatePreviewResponse,
  LevelTemplatePreviewResponseSpecStepsItem,
} from '../api/generated/model';
import { useTierOverview } from '../api/queries';
import { describeApiError } from './describe-error';
const useStyles = makeStyles({
  panel: {
    display: 'grid',
    // 窄屏（验收⑥）下必须塌成单列，否则 375px 会出现横向滚动。
    gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)',
    gap: '16px',
    '@media (max-width: 720px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minWidth: 0,
  },
  templateList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  templateCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    // 边界用 colorNeutralStrokeAccessible（→ --sm-border-control）而不是 Stroke2。
    // Stroke1/2 在 theme.ts 里都映射到 `border-hairline`（深色是 9% 白，对底
    // 1.22:1），那是分隔线用的；这张卡是可点选的 radio，边框是「这里能点」的
    // 唯一证据，WCAG 1.4.11 要求 ≥3:1。用 hairline 等于用可访问性换装饰性。
    border: `1px solid ${tokens.colorNeutralStrokeAccessible}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    textAlign: 'left',
    background: 'transparent',
    font: 'inherit',
    color: 'inherit',
    minWidth: 0,
  },
  templateCardActive: {
    border: `2px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorBrandBackground2,
  },
  metaRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  badge: {
    whiteSpace: 'nowrap',
  },
  controls: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  previewCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minWidth: 0,
  },
  stepList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  step: {
    display: 'flex',
    gap: '8px',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusSmall,
    background: tokens.colorNeutralBackground3,
  },
  stepTitle: {
    fontWeight: tokens.fontWeightSemibold,
  },
  firstScreen: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px 10px',
    borderLeft: `3px solid ${tokens.colorBrandStroke2}`,
    background: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusSmall,
  },
  actions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  // 长知识点名 / 关卡名在窄列里必须能断，否则撑破 grid。
  wrapText: {
    overflowWrap: 'anywhere',
  },
});

/** 三档的展示名。行为说明从 tier 投影读，这里只说「哪一档」。 */
export const TIER_CHOICES = ['P1', 'P2', 'P3'] as const;
export type TierChoice = (typeof TIER_CHOICES)[number];

const TIER_FALLBACK_LABEL: Record<TierChoice, string> = {
  P1: 'P1 · 更多示范与引导',
  P2: 'P2 · 标准节奏',
  P3: 'P3 · 更少脚手架',
};

const TEMPLATE_TYPE_LABEL: Record<string, string> = {
  teaching: '教学关',
  quiz: '练习关',
};

const STEP_KIND_LABEL: Record<string, string> = {
  guide: '引导',
  detail: '展示细节',
  probe: '简单问题',
  deepen: '深究',
  reteach: '进一步讲解',
  quiz: '判定',
  summary: '小结',
};

/** 「几段、几题、适合谁」——验收①要求的三个数，全部从模板自身的声明算。 */
export function templateFacts(template: LevelTemplateListResponseTemplatesItem): {
  segmentCount: number;
  itemCount: number;
  cardCount: number;
  audience: string;
} {
  const itemCount = template.segments.reduce((sum, segment) => sum + segment.itemCount, 0);
  const cardCount = template.segments.reduce((sum, segment) => sum + segment.cardCount, 0);
  return {
    segmentCount: template.segments.length,
    itemCount,
    cardCount,
    audience: template.summary,
  };
}

/** 某一档位下真正会出现的段（与 `fillLevelTemplate` 的过滤规则一致）。 */
export function segmentsForTier(
  template: LevelTemplateListResponseTemplatesItem,
  tier: TierChoice,
): LevelTemplateListResponseTemplatesItem['segments'] {
  return template.segments.filter((segment) => segment.tiers.includes(tier));
}

/**
 * 首段形态的判定。
 *
 * 与 `packages/engine/src/tier.ts` 的 `planFirstRound` 是同一个问题的两面：
 * 引擎看「档位决定从第几段起步」，这里看「模板填出来的草稿第一段是什么」。
 * 不 import 引擎（依赖边界），所以按段的 kind 判 —— 首段带题的，就是
 * 「直接出题」；首段是讲解带卡片的，就是「先看样例」。
 */
export function firstScreenShape(
  steps: LevelTemplatePreviewResponseSpecStepsItem[],
): { label: string; detail: string } {
  const first = steps[0];
  if (!first) return { label: '空关卡', detail: '这个模板在当前档位下没有可用的段。' };
  const label = STEP_KIND_LABEL[first.kind] ?? first.kind;
  if (first.itemIds.length > 0) {
    return {
      label: `首屏直接出题（${label}）`,
      detail: `第 1 段「${first.title}」就是 ${first.itemIds.length} 道题，没有先看样例的铺垫。`,
    };
  }
  return {
    label: `首屏先看讲解（${label}）`,
    detail: `第 1 段「${first.title}」是讲解，${first.cardIds.length} 张卡片，看完再做题。`,
  };
}

export interface TemplatePanelProps {
  templates: LevelTemplateListResponseTemplatesItem[];
  templatesPending: boolean;
  templatesError: unknown;
  microKpId: string;
  onMicroKpIdChange: (value: string) => void;
  preview: LevelTemplatePreviewResponse | undefined;
  previewPending: boolean;
  previewError: unknown;
  onPreview: (templateId: string, tier: TierChoice, microKpId: string) => void;
  onSave: (spec: unknown) => void;
  savePending: boolean;
  saveError: unknown;
  saveResult: { levelId: string; created: boolean } | undefined;
}

export function TemplatePanel({
  templates,
  templatesPending,
  templatesError,
  microKpId,
  onMicroKpIdChange,
  preview,
  previewPending,
  previewError,
  onPreview,
  onSave,
  savePending,
  saveError,
  saveResult,
}: TemplatePanelProps) {
  const styles = useStyles();
  const tierOverview = useTierOverview();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [tier, setTier] = useState<TierChoice>('P1');

  const selected = templates.find((item) => item.templateId === selectedId);

  const tierLabel = (choice: TierChoice): string => {
    const current = tierOverview.payload;
    // 只有当前档位能拿到服务端的说法；另两档用本地兜底（不硬编码行为数值，
    // 只说「示范多 / 标准 / 脚手架少」这类不含数字的描述）。
    if (current && choice === current.tier && current.label) {
      return `${choice} · ${current.label}`;
    }
    return TIER_FALLBACK_LABEL[choice];
  };

  return (
    <Card>
      <CardHeader
        header={<Text weight="semibold">从模板开一关</Text>}
        description={
          <Body1>
            选一个模板、一个知识点和一种节奏，先看草稿长什么样。草稿不会落库，
            确认后再保存成你自己的关卡。
          </Body1>
        }
      />

      <div className={styles.panel}>
        <div className={styles.column}>
          {templatesPending && <Spinner label="载入模板…" />}
          {templatesError !== null && templatesError !== undefined && (
            <MessageBar intent="error">
              <MessageBarBody>无法读取关卡模板：{describeApiError(templatesError)}</MessageBarBody>
            </MessageBar>
          )}
          {!templatesPending && templates.length === 0 && (
            <MessageBar>
              <MessageBarBody>
                还没有可用的关卡模板。模板由服务端内置（教学关 / 练习关 / 复习关），
                这里读不到说明接口没接上，而不是「模板用完了」。
              </MessageBarBody>
            </MessageBar>
          )}

          <div className={styles.templateList} role="radiogroup" aria-label="关卡模板">
            {templates.map((template) => {
              const facts = templateFacts(template);
              const active = template.templateId === selectedId;
              return (
                <button
                  key={template.templateId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={template.name}
                  className={`${styles.templateCard} ${active ? styles.templateCardActive : ''}`}
                  onClick={() => setSelectedId(template.templateId)}
                >
                  <Text weight="semibold" className={styles.wrapText}>
                    {template.name}
                  </Text>
                  <div className={styles.metaRow}>
                    <Badge appearance="outline" className={styles.badge}>
                      {TEMPLATE_TYPE_LABEL[template.type] ?? template.type}
                    </Badge>
                    <Body1>
                      {facts.segmentCount} 段 · {facts.itemCount} 题
                      {facts.cardCount > 0 ? ` · ${facts.cardCount} 张卡` : ''}
                    </Body1>
                  </div>
                  <Text size={200} className={styles.wrapText}>
                    适合谁：{facts.audience}
                  </Text>
                </button>
              );
            })}
          </div>

          <Divider />

          <div className={styles.controls}>
            <Field label="知识点 id">
              <input
                aria-label="模板预览的知识点 id"
                value={microKpId}
                onChange={(event) => onMicroKpIdChange(event.target.value)}
                placeholder="知识点 id，例如 kp-bool"
                style={{
                  font: 'inherit',
                  padding: '6px 8px',
                  borderRadius: tokens.borderRadiusMedium,
                  border: `1px solid ${tokens.colorNeutralStroke1}`,
                  background: tokens.colorNeutralBackground1,
                  color: tokens.colorNeutralForeground1,
                }}
              />
            </Field>

            <Field label="节奏档位">
              <Dropdown
                aria-label="节奏档位"
                value={tierLabel(tier)}
                selectedOptions={[tier]}
                onOptionSelect={(_, data) => {
                  const next = data.optionValue as TierChoice | undefined;
                  if (next) setTier(next);
                }}
              >
                {TIER_CHOICES.map((choice) => (
                  <Option key={choice} value={choice} text={tierLabel(choice)}>
                    {tierLabel(choice)}
                  </Option>
                ))}
              </Dropdown>
            </Field>

            <Button
              appearance="primary"
              disabled={!selected || !microKpId.trim() || previewPending}
              onClick={() => {
                if (!selected) return;
                onPreview(selected.templateId, tier, microKpId.trim());
              }}
            >
              预览
            </Button>
          </div>
        </div>

        <div className={styles.column}>
          {previewPending && <Spinner label="正在按模板填草稿…" />}
          {previewError !== null && previewError !== undefined && (
            <MessageBar intent="error">
              <MessageBarBody>预览失败：{describeApiError(previewError)}</MessageBarBody>
            </MessageBar>
          )}

          {!preview && !previewPending && previewError == null && (
            <MessageBar>
              <MessageBarBody>
                左边选好模板、知识点和档位后点「预览」，这里会显示填出来的关卡草稿。
              </MessageBarBody>
            </MessageBar>
          )}

          {preview && (
            <div className={styles.previewCard}>
              <div className={styles.metaRow}>
                <Badge appearance="tint" color="brand" className={styles.badge}>
                  {preview.tier}
                </Badge>
                <Badge appearance="outline" className={styles.badge}>
                  {preview.spec.steps.length} 段
                </Badge>
                <Badge appearance="outline" className={styles.badge}>
                  {preview.spec.items.length} 题
                </Badge>
                <Badge appearance="outline" className={styles.badge}>
                  未落库
                </Badge>
              </div>

              <Text weight="semibold" className={styles.wrapText}>
                {preview.spec.meta.title}
              </Text>

              <div className={styles.firstScreen}>
                <Text size={200} weight="semibold">
                  {firstScreenShape(preview.spec.steps).label}
                </Text>
                <Text size={200}>{firstScreenShape(preview.spec.steps).detail}</Text>
              </div>

              <ol className={styles.stepList} aria-label="预览的段">
                {preview.spec.steps.map((step, index) => (
                  <li key={step.id} className={styles.step}>
                    <Text size={200}>第 {index + 1} 段</Text>
                    <Text className={styles.stepTitle}>{step.title}</Text>
                    <Badge appearance="outline" className={styles.badge}>
                      {STEP_KIND_LABEL[step.kind] ?? step.kind}
                    </Badge>
                    <Text size={200}>
                      {step.itemIds.length} 题
                      {step.cardIds.length > 0 ? ` · ${step.cardIds.length} 张卡` : ''}
                    </Text>
                  </li>
                ))}
              </ol>

              <div className={styles.actions}>
                <Button
                  appearance="primary"
                  disabled={savePending}
                  onClick={() => onSave(preview.spec)}
                >
                  保存为我的关卡
                </Button>
              </div>

              {saveError !== null && saveError !== undefined && (
                <MessageBar intent="error">
                  <MessageBarBody>保存失败：{describeApiError(saveError)}</MessageBarBody>
                </MessageBar>
              )}

              {saveResult && (
                <MessageBar intent="success">
                  <MessageBarBody>
                    {saveResult.created ? '已保存成新关卡' : '这个组合之前保存过，已按新草稿覆盖'}
                    ：{saveResult.levelId}
                  </MessageBarBody>
                </MessageBar>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
