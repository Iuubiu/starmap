/**
 * 技能库（票 15）。
 *
 * ## 这一页要回答的问题
 *
 * 不是「有哪些文件」，而是「此刻智能体脑子里装着什么」。所以每个 skill 一行，
 * 每行必须同时给出：它是什么、什么时候会被触发、当前是启用还是禁用。
 * 「启用」不是装饰性开关 —— 关掉之后它真的不再出现在 system message 里，
 * 页面下方那块预览就是这条断言的可视化证据。
 *
 * ## 为什么开关要配一块 system message 预览
 *
 * 只说「已禁用」是自证；把拼好的 system message 原文摊开，才能让人**看到**
 * 文本确实短了一截。这不是调试工具，是这一页的核心说服力：禁用是按目录摘除
 * 实现的（`apps/api/src/mastra/skills/system-message.ts`），不是提示词里写
 * 「请不要使用 X」—— 后者模型完全可以不听话，前者不可能不听话。
 *
 * ## 为什么正文只读
 *
 * 写入 skill 等于改智能体的行为。这类改动应当过版本控制、能被 diff、能被
 * 回滚 —— 在网页里直接编辑提示词恰好把这三件事全丢掉。所以这页只读，
 * 要改就去仓库里改（页面上也这么说明）。
 *
 * ## 为什么不做导入导出
 *
 * skill 就是文件，迁移它靠文件系统。加一个导出按钮只是把同一份东西复制成
 * 第二个可能过期的地方。
 */
import { useMemo, useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Card,
  Divider,
  Field,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Switch,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  useSkill,
  useSkillSystemPreview,
  useSkills,
  useToggleSkill,
} from '../api/queries';
import type { SkillListResponseItemsItem } from '../api/generated/model';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '1180px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
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
  twoCol: {
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)',
    gap: '20px',
    alignItems: 'start',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '12px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
  },
  rowActive: {
    outline: `2px solid ${tokens.colorBrandStroke1}`,
  },
  rowDisabled: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  rowHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  name: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    wordBreak: 'break-all',
  },
  triggers: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
  },
  detail: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
  },
  metaRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  instructions: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    backgroundColor: tokens.colorNeutralBackground2,
    padding: '12px',
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: '420px',
    overflowY: 'auto',
  },
  refBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  refRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 10px',
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  refName: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  preview: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase200,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    backgroundColor: tokens.colorNeutralBackground2,
    padding: '12px',
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: '380px',
    overflowY: 'auto',
  },
  subtle: { color: tokens.colorNeutralForeground3 },
  bullets: {
    margin: 0,
    paddingLeft: '20px',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
});

export function SkillsPage() {
  const styles = useStyles();
  const skills = useSkills();
  const [selected, setSelected] = useState<string | undefined>();

  const items = useMemo(() => skills.payload?.items ?? [], [skills.payload]);
  const activeName = selected ?? items[0]?.name;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          技能库
        </Text>
        <Body1>
          这些 skill 决定了智能体怎么追问、怎么出题。启用的会原样写进它的
          system message；禁用的连名字都不会出现——不是「告诉它别用」，是它根本没被装进去。
        </Body1>
      </div>

      {skills.isPending && <Spinner label="扫描 skill 目录…" />}

      {skills.isError && (
        <MessageBar intent="error">
          <MessageBarTitle>无法读取技能库</MessageBarTitle>
          <MessageBarBody>
            {skills.error instanceof Error ? skills.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      {skills.payload && (
        <div className={styles.twoCol}>
          <div className={styles.list}>
            <div className={styles.metaRow}>
              <Badge appearance="tint" color="brand">
                共 {items.length} 个
              </Badge>
              <Badge appearance="tint" color="success">
                启用 {skills.payload.enabledCount}
              </Badge>
              {skills.payload.disabledCount > 0 && (
                <Badge appearance="tint" color="warning">
                  禁用 {skills.payload.disabledCount}
                </Badge>
              )}
            </div>
            <Caption1 className={styles.subtle}>
              扫描自 {skills.payload.directory}
            </Caption1>

            {items.length === 0 && (
              <MessageBar>
                <MessageBarBody>
                  这个目录下还没有 skill。新建 `&lt;名字&gt;/SKILL.md` 就会出现在这里。
                </MessageBarBody>
              </MessageBar>
            )}

            {items.map((item) => (
              <SkillRow
                key={item.name}
                item={item}
                active={item.name === activeName}
                onSelect={() => setSelected(item.name)}
              />
            ))}
          </div>

          <SkillDetailPanel name={activeName} />
        </div>
      )}

      <Divider />

      <SystemPreview />

      <Divider />

      <Card>
        <Text weight="semibold" as="h2">
          怎么迁移和修改
        </Text>
        <ul className={styles.bullets}>
          <li>
            skill 就是文件：`apps/api/src/mastra/skills/&lt;目录名&gt;/SKILL.md`，附带的
            <code> references/</code> 放补充材料。目录名必须与 frontmatter 里的 name 一致。
          </li>
          <li>改提示词请改文件并走版本控制——网页里不提供在线编辑，因为那次改动不可 diff、不可回滚。</li>
          <li>迁移到另一台机器等于把这些目录带过去；没有导入导出，也不需要。</li>
          <li>启用/禁用状态存在数据库里（`app.skill_switches`），重启后保持；新增的 skill 默认启用。</li>
        </ul>
      </Card>
    </div>
  );
}

function SkillRow({
  item,
  active,
  onSelect,
}: {
  item: SkillListResponseItemsItem;
  active: boolean;
  onSelect: () => void;
}) {
  const styles = useStyles();
  const toggle = useToggleSkill();
  const className = [
    styles.row,
    active ? styles.rowActive : undefined,
    item.enabled ? undefined : styles.rowDisabled,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      aria-label={`${item.name}，${item.enabled ? '启用' : '禁用'}，${item.description}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className={styles.rowHeader}>
        <Text className={styles.name}>{item.name}</Text>
        <Badge appearance="outline" size="small">
          v{item.version}
        </Badge>
      </div>
      <Text size={200}>{item.description}</Text>
      {item.triggerScenarios.length > 0 && (
        <div className={styles.triggers}>
          {item.triggerScenarios.slice(0, 4).map((scenario) => (
            <Badge key={scenario} appearance="tint" size="small" color="informative">
              {scenario}
            </Badge>
          ))}
          {item.triggerScenarios.length > 4 && (
            <Caption1 className={styles.subtle}>
              +{item.triggerScenarios.length - 4}
            </Caption1>
          )}
        </div>
      )}
      <div className={styles.rowHeader}>
        <Caption1 className={styles.subtle}>
          {item.referenceCount > 0 ? `${item.referenceCount} 个参考文件` : '无参考文件'}
        </Caption1>
        {/*
         * 开关自己吞掉点击：这一行的父容器是「选中查看」，而切换启用状态不是
         * 选中。不 stopPropagation 的话点开关会顺带把详情切过去，看起来很警。
         */}
        <div onClick={(event) => event.stopPropagation()}>
          <Switch
            checked={item.enabled}
            disabled={toggle.isPending && toggle.variables?.name === item.name}
            onChange={(_, data) => toggle.mutate({ name: item.name, enabled: data.checked })}
            label={item.enabled ? '启用' : '禁用'}
            labelPosition="before"
            aria-label={`${item.name} 启用开关`}
          />
        </div>
      </div>
      {toggle.isError && toggle.variables?.name === item.name && (
        <Caption1 className={styles.subtle}>
          切换失败：{toggle.error instanceof Error ? toggle.error.message : '未知错误'}
        </Caption1>
      )}
    </div>
  );
}

function SkillDetailPanel({ name }: { name: string | undefined }) {
  const styles = useStyles();
  const skill = useSkill(name);

  if (!name) {
    return (
      <Card>
        <Body1>左侧选一个 skill 查看它的正文和参考文件。</Body1>
      </Card>
    );
  }

  if (skill.isPending) return <Spinner label="读取 skill 正文…" />;

  if (skill.isError) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          无法读取 skill：{skill.error instanceof Error ? skill.error.message : '未知错误'}
        </MessageBarBody>
      </MessageBar>
    );
  }

  const detail = skill.payload?.skill;
  if (!detail) return null;

  return (
    <div className={styles.detail}>
      <div className={styles.metaRow}>
        <Text className={styles.name} as="h2">
          {detail.name}
        </Text>
        <Badge appearance="outline">v{detail.version}</Badge>
        <Badge appearance="tint" color={detail.enabled ? 'success' : 'warning'}>
          {detail.enabled ? '启用中' : '已禁用'}
        </Badge>
        <Caption1 className={styles.subtle}>目录 {detail.directoryName}</Caption1>
      </div>

      <Body1>{detail.description}</Body1>

      {detail.triggerScenarios.length > 0 && (
        <Field label="触发场景">
          <div className={styles.triggers}>
            {detail.triggerScenarios.map((scenario) => (
              <Badge key={scenario} appearance="tint" size="small" color="informative">
                {scenario}
              </Badge>
            ))}
          </div>
        </Field>
      )}

      {!detail.validation.valid && (
        <MessageBar intent="warning">
          <MessageBarTitle>这个 skill 不会被加载</MessageBarTitle>
          <MessageBarBody>
            {detail.validation.errors.join('；') || '元数据不合法'}
          </MessageBarBody>
        </MessageBar>
      )}

      {detail.validation.valid && detail.validation.warnings.length > 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>{detail.validation.warnings.join('；')}</MessageBarBody>
        </MessageBar>
      )}

      <Field label="正文（只读）">
        <div className={styles.instructions}>{detail.instructions}</div>
      </Field>

      <Field label={`参考文件（${detail.references.length}）`}>
        {detail.references.length === 0 ? (
          <Caption1 className={styles.subtle}>没有 references/ 下的文件。</Caption1>
        ) : (
          <div className={styles.refBlock}>
            {detail.references.map((reference) => (
              <div key={reference.name} className={styles.refRow}>
                <Text className={styles.refName}>
                  {reference.name}{' '}
                  <Caption1 className={styles.subtle}>{formatSize(reference.sizeBytes)}</Caption1>
                </Text>
                <Caption1 className={styles.subtle}>{reference.preview}</Caption1>
              </div>
            ))}
          </div>
        )}
      </Field>

      <Caption1 className={styles.subtle}>
        参考文件不进入 system message —— 只有正文会被注入。这是「渐进披露」的落点：
        需要查具体措辞时才由正文里的指引去展开。
      </Caption1>
    </div>
  );
}

/**
 * system message 预览。
 *
 * 这是整页的**证据**：禁用前这里是 8 个 skill 拼成的长文，禁用后那段真的
 * 不在里面了。没有这块，开关就只是个 UI 状态。
 */
function SystemPreview() {
  const styles = useStyles();
  const preview = useSkillSystemPreview();

  if (preview.isPending) return <Spinner label="拼装 system message…" />;

  if (preview.isError) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          无法读取预览：{preview.error instanceof Error ? preview.error.message : '未知错误'}
        </MessageBarBody>
      </MessageBar>
    );
  }

  const payload = preview.payload;
  if (!payload) return null;

  return (
    <Card>
      <div className={styles.metaRow}>
        <Text weight="semibold" as="h2">
          智能体此刻收到的 system message
        </Text>
        <Badge appearance="tint" color="success">
          包含 {payload.includedSkills.length} 个
        </Badge>
        {payload.excludedSkills.length > 0 && (
          <Badge appearance="tint" color="warning">
            已排除 {payload.excludedSkills.length} 个：{payload.excludedSkills.join('、')}
          </Badge>
        )}
      </div>
      <Caption1 className={styles.subtle}>
        这是下一轮对话真正会发给模型的文本。禁用的 skill 在这里一个字符都不出现。
      </Caption1>
      <div className={styles.preview}>{payload.systemMessage}</div>
    </Card>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 便于测试与将来复用：把一行 skill 的 aria-label 说出来。 */
export function skillRowLabel(item: SkillListResponseItemsItem): string {
  return `${item.name}：${item.enabled ? '启用' : '禁用'}`;
}
