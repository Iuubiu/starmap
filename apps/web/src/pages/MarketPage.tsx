import { useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Card,
  CardHeader,
  Divider,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useNavigate } from 'react-router';
import { useMarketLevels } from '../api/queries';
import type { MarketLevelListResponseItemsItem } from '../api/generated/model';

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
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  metaRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  // Fluent 的 Badge 按容器宽度折行，中文在窄容器里会竖排成一行一个字。
  badge: {
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
  authorBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '520px',
  },
  authorRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end',
  },
});

const KIND_LABEL: Record<string, string> = {
  teach: '教学关卡',
  quiz: '题目关卡',
  mixed: '综合关卡',
};

const AUTHOR_LABEL: Record<string, string> = {
  system: '系统预制',
  teacher: '教师编写',
  self: '我自己保存的',
  ai: 'AI 生成',
};

/** 本地时区的 `YYYY-MM-DD HH:mm`，不依赖 toLocaleString 的平台差异。 */
function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function LevelCard({
  level,
  styles,
  onRestart,
  onEdit,
}: {
  level: MarketLevelListResponseItemsItem;
  styles: ReturnType<typeof useStyles>;
  onRestart: () => void;
  onEdit: () => void;
}) {
  const saved = level.origin === 'saved';
  return (
    <Card>
      <CardHeader
        header={<Text weight="semibold">{level.title}</Text>}
        description={
          <div className={styles.metaRow}>
            <Badge appearance="outline" className={styles.badge}>
              {KIND_LABEL[level.kind] ?? level.kind}
            </Badge>
            <Badge
              appearance="tint"
              color={saved ? 'brand' : 'subtle'}
              className={styles.badge}
            >
              {saved ? '我保存的' : '预制'}
            </Badge>
            <Body1>
              {level.microKpName} · {level.itemCount} 道题 · {AUTHOR_LABEL[level.author] ?? level.author}
            </Body1>
          </div>
        }
        action={
          <div className={styles.actions}>
            {saved && <Button appearance="secondary" onClick={onEdit}>继续编辑</Button>}
            <Button appearance="primary" onClick={onRestart}>重新开始</Button>
          </div>
        }
      />
      {(saved || level.tags.length > 0) && (
        <div className={styles.metaRow}>
          {level.tags.map((tag) => (
            <Badge key={tag} appearance="outline" className={styles.badge}>
              {tag}
            </Badge>
          ))}
          {saved && level.savedAt && (
            <Text size={200}>保存于 {formatSavedAt(level.savedAt)}</Text>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * 关卡市场页（票 14）。
 *
 * ## 这个页面只做「保存」，不做「分发」
 *
 * 用户明确否决了「上传到市场做真实分发」，`spec.md:496` 也把真实分发列为
 * Out of Scope。所以这里：
 *   - 没有分享 / 上传 / 发布到社区的按钮，也没有它们的占位；
 *   - 页面顶部直接写清楚「只在你自己的工作台上可见」；
 *   - 后端也没有对应的路由（见 `market.controller.test.ts` 的路由表断言）。
 *
 * 把「没有分发」写成一句用户能读到的话，而不是靠「界面上碰巧没有按钮」——
 * 后者在下次加功能时会被无声地破坏，前者读起来像承诺。
 *
 * ## 为什么两种关卡放在同一页而不是两个页面
 *
 * 学习者关心的是「我能从哪儿开始练」，不是「这关是谁做的」。分成「官方 /
 * 我的」两个页面会逼用户先选一个身份再找内容，而市场页的核心动作是
 * 浏览 → 重新开始。
 */
export function MarketPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const levels = useMarketLevels();
  const [draftMicroKpId, setDraftMicroKpId] = useState('');
  const [authorError, setAuthorError] = useState<string | null>(null);

  const goAuthor = (microKpId: string) => {
    const id = microKpId.trim();
    if (!id) {
      setAuthorError('先填写知识点 id（例如 kp-bool），再开始打包。');
      return;
    }
    setAuthorError(null);
    navigate(`/market/author/${encodeURIComponent(id)}`);
  };

  if (levels.isPending) {
    return (
      <div className={styles.page}>
        <Spinner label="载入关卡市场…" />
      </div>
    );
  }

  if (levels.isError || !levels.payload) {
    return (
      <div className={styles.page}>
        <MessageBar intent="error">
          <MessageBarBody>
            无法读取关卡市场：{levels.error instanceof Error ? levels.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      </div>
    );
  }

  const saved = levels.payload.items.filter((item) => item.origin === 'saved');
  const presets = levels.payload.items.filter((item) => item.origin === 'preset');

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          关卡市场
        </Text>
        <Body1>预制关卡，加上你自己保存的关卡。</Body1>
      </div>

      {/*
        * 验收④：把「保存 ≠ 分发」写成页面上的话。这不是免责声明，而是这个
        * 功能当前的真实语义 —— 用户以为「保存」等于「发布出去」时会做出
        * 自己收不回来的动作，而这里根本收不回来，因为压根没发出去。
        */}
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>这里只做「保存」，不做「分发」</MessageBarTitle>
          你保存的关卡只在这台工作台上可见：可以自己重新开始、继续编辑，但不会上传到任何社区，
          也没有分享给别人的入口。想让别人玩到，目前只能自己导出关卡文件。
        </MessageBarBody>
      </MessageBar>

      <div className={styles.section}>
        <Text weight="semibold">我保存的关卡</Text>
        {saved.length === 0 ? (
          <MessageBar>
            <MessageBarBody>
              还没有保存过自制关卡。学完一个知识点后，在下面把那段学习过程打包成草案，补全细节再保存。
            </MessageBarBody>
          </MessageBar>
        ) : (
          <div className={styles.list}>
            {saved.map((level) => (
              <LevelCard
                key={level.levelId}
                level={level}
                styles={styles}
                onRestart={() => navigate(`/level/${encodeURIComponent(level.levelId)}`)}
                onEdit={() =>
                  navigate(
                    `/market/author/${encodeURIComponent(level.microKpId)}?levelId=${encodeURIComponent(level.levelId)}`,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      <Divider />

      <div className={styles.section}>
        <Text weight="semibold">预制关卡</Text>
        {presets.length === 0 ? (
          <MessageBar>
            <MessageBarBody>还没有预制关卡。</MessageBarBody>
          </MessageBar>
        ) : (
          <div className={styles.list}>
            {presets.map((level) => (
              <LevelCard
                key={level.levelId}
                level={level}
                styles={styles}
                onRestart={() => navigate(`/level/${encodeURIComponent(level.levelId)}`)}
                onEdit={() => undefined}
              />
            ))}
          </div>
        )}
      </div>

      <Divider />

      <Card>
        <CardHeader
          header={<Text weight="semibold">把一段学习过程打包成关卡</Text>}
          description={
            <Body1>
              输入知识点 id，系统会把你在这个知识点上做过的题、错题的错因、看过的讲解片段
              打包成一份关卡草案。草案可以改，校验通过才存得进关卡库。
            </Body1>
          }
        />
        <div className={styles.authorBox}>
          <div className={styles.authorRow}>
            <Input
              value={draftMicroKpId}
              onChange={(_, data) => setDraftMicroKpId(data.value)}
              placeholder="知识点 id，例如 kp-bool"
              aria-label="知识点 id"
            />
            <Button appearance="primary" onClick={() => goAuthor(draftMicroKpId)}>
              开始打包
            </Button>
          </div>
          {authorError && (
            <MessageBar intent="warning">
              <MessageBarBody>{authorError}</MessageBarBody>
            </MessageBar>
          )}
        </div>
      </Card>
    </div>
  );
}
