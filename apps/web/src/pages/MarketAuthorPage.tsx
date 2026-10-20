import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Card,
  CardHeader,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useCreateMarketDraft, useMarketLevel, useSaveMarketLevel } from '../api/queries';
import type { MarketSpecIssue } from '../api/generated/model';
import { ApiClientError } from '../api/fetcher';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '980px',
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
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  badge: {
    whiteSpace: 'nowrap',
  },
  editor: {
    width: '100%',
    minHeight: '420px',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  issues: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  issueRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'baseline',
  },
  issuePath: {
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorPaletteRedForeground1,
    minWidth: '180px',
  },
  learningList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
});

/**
 * 把后端错误响应里的 `details` 收敛成可渲染的 `{path,message,code}[]`。
 *
 * ## 为什么这个函数要兼容两种形状
 *
 * 因为服务端**真的会返回两种**（实测，见 `market.controller.test.ts` 里
 * 「422 与 400 的 details 是两种形状」那条）：
 *
 *   - **422**（spec 语义不合法）→ `validateLevelSpec()` 的 issues，
 *     `path` 是**点号字符串**：`{path:'items.0.sourceRef', message, code}`
 *   - **400**（请求体语法不合法）→ Zod 原生 `error.issues`，
 *     `path` 是**数组**：`{path:['spec'], code:'invalid_type', message, ...}`
 *
 * 少了数组那一路，用户传错请求体时看到的是一个**空的**错误列表 —— 比不显示
 * 更糟，因为它看起来像「没有错误」。
 *
 * ## 为什么它对第三种形状也不崩
 *
 * `details` 在契约里是 `z.unknown()`（形状由各控制器决定），所以它也可能是
 * `null`、一个对象、或者一个元素不是对象的数组。这里一律退化成空列表而不是
 * 抛异常：错误渲染路径自己再抛错，会把「展示错误」变成「白屏」。
 *
 * 导出是为了让它有一条独立测试 —— 这个函数看起来像「万能的防御性函数」，
 * 那种函数最容易在下一个人手里被当冗余删掉，因为没人知道它防的是什么。
 */
export function toIssues(raw: unknown): MarketSpecIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: MarketSpecIssue[] = [];
  for (const item of raw) {
    // `Array.isArray` 要单独判：数组的 `typeof` 也是 'object'，不排掉的话
    // 一个嵌套数组会变成一条 {path:'', message:'未知问题'} 的噪声。
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const r = item as { path?: unknown; message?: unknown; code?: unknown };
    // Zod 原生 issue 的 path 是数组；契约里的 path 是点号字符串。
    const path = Array.isArray(r.path)
      ? r.path.join('.')
      : typeof r.path === 'string'
        ? r.path
        : '';
    out.push({
      path,
      message: typeof r.message === 'string' ? r.message : '未知问题',
      code: typeof r.code === 'string' ? r.code : 'invalid',
    });
  }
  return out;
}

/**
 * 自制关卡编辑页 `/market/author/:microKpId`（票 14 验收①②）。
 *
 * ## 为什么编辑器是一个 JSON 文本框
 *
 * 票 14 要求「草稿可编辑补全」，但没有要求一套表单化的关卡编辑器。做表单
 * 意味着把 `LevelSpecSchema` 的每个字段在 UI 里再描述一遍 —— 那份描述会与
 * `packages/shared/src/domain/level.ts` 各自演化，最终出现「表单说能存、
 * 校验器说不能」的分裂。JSON 文本框 + **同一个校验器的字段级报错**，
 * 保证界面上说的和存库时判的永远是同一套规则。
 *
 * ## 校验发生在哪
 *
 * 不在前端。前端只做「JSON.parse 是否成功」这一件事（语法），语义合法性
 * 完全交给 `POST /market/levels` 背后的 `validateLevelSpec()`。这样「浏览器
 * 认为合法」与「服务端认为合法」不可能不一致 —— 前端根本没有第二份判断。
 *
 * ## 两条入口
 *
 *   - 从零打包：进来就用 `POST /market/drafts` 把这段学习过程变成草稿
 *   - 继续编辑：带 `?levelId=...`，先取回已保存的 spec 再编辑
 */
export function MarketAuthorPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { microKpId } = useParams<{ microKpId: string }>();
  const [searchParams] = useSearchParams();
  const editingLevelId = searchParams.get('levelId');

  const createDraft = useCreateMarketDraft();
  const existing = useMarketLevel(editingLevelId ?? undefined);
  const save = useSaveMarketLevel();

  const [text, setText] = useState('');
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [learned, setLearned] = useState<{
    attemptCount: number;
    correctCount: number;
    items: { itemId: string; stem: string; correct: boolean | null; misconceptionTags: string[] }[];
    sourceLevelIds: string[];
  } | null>(null);

  // 从零打包：进页面就发一次。用 effect 而不是按钮，是因为「打包草稿」是
  // 用户的进入意图本身（他从市场页点了「开始打包」），再点一次只是多一步。
  const draftMutate = createDraft.mutate;
  useEffect(() => {
    if (editingLevelId) return;
    if (!microKpId) return;
    draftMutate(
      { microKpId },
      {
        onSuccess: (payload) => {
          setText(JSON.stringify(payload.spec, null, 2));
          setLearned({
            attemptCount: payload.learning.attemptCount,
            correctCount: payload.learning.correctCount,
            items: payload.learning.items,
            sourceLevelIds: payload.learning.sourceLevelIds,
          });
        },
      },
    );
  }, [draftMutate, editingLevelId, microKpId]);

  // 继续编辑：把已保存的 spec 装进文本框。
  useEffect(() => {
    if (!editingLevelId) return;
    const payload = existing.payload;
    if (!payload) return;
    setText(JSON.stringify(payload.spec, null, 2));
  }, [editingLevelId, existing.payload]);

  const loading = editingLevelId ? existing.isPending : createDraft.isPending;
  const loadError = editingLevelId ? existing.error : createDraft.error;

  /** 保存前的**唯一**前端检查：能不能 parse 成 JSON。 */
  const onSave = () => {
    setSyntaxError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      setSyntaxError(error instanceof Error ? error.message : 'JSON 解析失败');
      return;
    }
    save.mutate({ spec: parsed });
  };

  const saveError = save.error;
  const validationIssues = useMemo(() => {
    if (!(saveError instanceof ApiClientError)) return [];
    return toIssues(saveError.details);
  }, [saveError]);

  if (loading) {
    return (
      <div className={styles.page}>
        <Spinner label={editingLevelId ? '载入已保存的关卡…' : '打包这段学习过程…'} />
      </div>
    );
  }

  if (loadError || (editingLevelId && !existing.payload)) {
    return (
      <div className={styles.page}>
        <MessageBar intent="error">
          <MessageBarBody>
            无法载入关卡草案：
            {loadError instanceof Error ? loadError.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
        <div>
          <Button onClick={() => navigate('/market')}>返回关卡市场</Button>
        </div>
      </div>
    );
  }

  if (save.isSuccess) {
    const saved = save.data;
    return (
      <div className={styles.page}>
        <MessageBar intent="success">
          <MessageBarBody>
            <MessageBarTitle>{saved.created ? '已保存进关卡库' : '已更新关卡'}</MessageBarTitle>
            「{saved.level.title}」现在出现在关卡市场里，可以自己重新开始。
            这是保存，不是发布：它不会离开这台工作台。
          </MessageBarBody>
        </MessageBar>
        <div className={styles.row}>
          <Button appearance="primary" onClick={() => navigate(`/level/${encodeURIComponent(saved.level.levelId)}`)}>
            重新开始这一关
          </Button>
          <Button onClick={() => navigate('/market')}>回到关卡市场</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          {editingLevelId ? '继续编辑自制关卡' : '打包这段学习过程'}
        </Text>
        <Body1>
          知识点 <code>{microKpId}</code>
          {editingLevelId ? ` · 关卡 ${editingLevelId}` : ''}
        </Body1>
      </div>

      {learned && (
        <Card>
          <CardHeader
            header={<Text weight="semibold">这次学习里发生了什么</Text>}
            description={
              <Body1>
                作答 {learned.attemptCount} 次，其中 {learned.correctCount} 次正确 ·
                来自 {learned.sourceLevelIds.length} 张关卡
              </Body1>
            }
          />
          <div className={styles.learningList}>
            {learned.items.length === 0 ? (
              <Body1>这个知识点上还没有作答记录，草案里只有讲解卡。</Body1>
            ) : (
              learned.items.map((item) => (
                <div key={item.itemId} className={styles.row}>
                  <Badge
                    appearance="tint"
                    color={item.correct ? 'success' : 'danger'}
                    className={styles.badge}
                  >
                    {item.correct === null ? '未作答' : item.correct ? '做对' : '做错'}
                  </Badge>
                  <Body1>{item.stem}</Body1>
                  {item.misconceptionTags.map((tag) => (
                    <Badge key={tag} appearance="outline" className={styles.badge}>
                      {tag}
                    </Badge>
                  ))}
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      <MessageBar intent="info">
        <MessageBarBody>
          下面是打包好的 <code>level.spec</code> JSON，可以直接改。保存时后端会用与内置关卡
          <strong>同一个</strong>校验器检查，不通过就不会入库，并逐条告诉你是哪个字段。
        </MessageBarBody>
      </MessageBar>

      {syntaxError && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>这不是合法的 JSON</MessageBarTitle>
            {syntaxError}
          </MessageBarBody>
        </MessageBar>
      )}

      {validationIssues.length > 0 && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>
              校验没通过（{validationIssues.length} 处），关卡**没有**入库
            </MessageBarTitle>
            <div className={styles.issues}>
              {validationIssues.map((issue, i) => (
                <div key={`${issue.path}-${i}`} className={styles.issueRow}>
                  <span className={styles.issuePath}>{issue.path || '(根)'}</span>
                  <Body1>{issue.message}</Body1>
                </div>
              ))}
            </div>
          </MessageBarBody>
        </MessageBar>
      )}

      <Textarea
        className={styles.editor}
        value={text}
        onChange={(_, data) => setText(data.value)}
        aria-label="关卡 JSON"
        resize="vertical"
      />

      <Divider />

      <div className={styles.row}>
        <Button appearance="primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? '保存中…' : '保存进关卡库'}
        </Button>
        <Button onClick={() => navigate('/market')} disabled={save.isPending}>
          取消
        </Button>
        {saveError instanceof ApiClientError && saveError.status === 409 && (
          <Text>关卡 id 或题目 id 与已有内容冲突，改一下 id 再存。</Text>
        )}
      </div>
    </div>
  );
}
