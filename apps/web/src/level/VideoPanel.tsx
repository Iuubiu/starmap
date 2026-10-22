/**
 * 关卡页的「看讲解」面板（票 19）。
 *
 * ## 为什么放在门控面板旁边而不是关卡开头
 *
 * 学习者需要讲解的时机是**卡住之后**：题做错了、或者门控没过。把它放在
 * 关卡最前面会变成「先看 30 分钟视频再做题」，那不是这个产品的用法
 * （关卡是主线，视频是补丁）。
 *
 * ## 为什么每片都显示「为什么从这里开始/结束」
 *
 * 票面验收第 3 条要求每片有可读的切分理由。把它展示出来有两个作用：
 * 学习者知道这 5 分钟讲的是什么、到哪儿结束；内容作者能一眼看出切得对不对。
 * 只存在数据库里的话，作者要写 SQL 才能发现问题。
 *
 * ## 为什么同时给「整片播放」和「从起点跳进原视频」
 *
 * 切片是 720p 转码过的，画质有损；原视频时间轴定位保留完整上下文
 * （前一片讲到一半时的那句话往往有用）。两种都给，让学习者自己选。
 *
 * ## 为什么空态要说「这个知识点还没有讲解视频」
 *
 * 「没有片段」与「加载失败」必须能分开：前者是内容还没配，后者要重试。
 * 这条在票面验收第 4 条里对应「每片至少对齐 1 个知识点」的反面 ——
 * 没对齐上的片段不显示在这里，页面就该说实话。
 */
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
import { OpenRegular, PlayRegular } from '@fluentui/react-icons';
import { clipSrc, formatClipTime, useLevelVideoClips } from '../api/queries';
import type { VideoClip } from '../api/queries';
const useStyles = makeStyles({
  card: {
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
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
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  clip: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '12px 14px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  clipHead: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  reason: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  excerpt: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  actions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '4px',
  },
  source: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase100,
  },
  video: {
    width: '100%',
    maxHeight: '360px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: '#000',
  },
});

/** 播放器：点开才挂 `<video>`（不预加载，避免一次请求 6 个 mp4）。 */
function ClipPlayer({ clip }: { clip: VideoClip }) {
  const styles = useStyles();
  return (
    <video className={styles.video} controls preload="none" src={clipSrc(clip)}>
      <track kind="captions" />
    </video>
  );
}

export interface VideoPanelProps {
  levelId: string;
}

export function VideoPanel({ levelId }: VideoPanelProps) {
  const styles = useStyles();
  const clips = useLevelVideoClips(levelId);

  if (clips.isPending) {
    return (
      <Card className={styles.card}>
        <Spinner size="tiny" label="查一下这个知识点有没有讲解视频…" />
      </Card>
    );
  }

  if (clips.isError) {
    // 视频是补充材料：加载失败不该挡住做题，所以只提示不阻断
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          讲解视频没能加载（{clips.error instanceof Error ? clips.error.message : '未知错误'}）。
          不影响做题，可以稍后刷新再看。
        </MessageBarBody>
      </MessageBar>
    );
  }

  const items = clips.payload?.items ?? [];

  return (
    <Card className={styles.card}>
      <CardHeader
        header={
          <div className={styles.headRow}>
            <Text weight="semibold">看讲解</Text>
            <Badge appearance="outline" className={styles.badge}>
              {items.length} 段
            </Badge>
          </div>
        }
        description={
          <Body1>
            这些片段是从公开课程里切出来的纯讲解区间（每段不超过 6 分钟），按知识点对齐到这一关。
          </Body1>
        }
      />
      <Divider />

      {items.length === 0 ? (
        <MessageBar>
          <MessageBarBody>
            这个知识点还没有配讲解视频。视频是按知识点名对齐的，没有对齐上的片段不会显示在这里 ——
            缺的是内容，不是加载失败。
          </MessageBarBody>
        </MessageBar>
      ) : (
        <div className={styles.list}>
          {items.map((clip) => (
            <div key={clip.clipId} className={styles.clip}>
              <div className={styles.clipHead}>
                <Badge appearance="filled" color="informative" className={styles.badge}>
                  {formatClipTime(clip.startSec)} – {formatClipTime(clip.endSec)}
                </Badge>
                <Text weight="semibold">{clip.microKpName ?? '未对齐知识点'}</Text>
                {clip.asrModel !== null && (
                  <Badge appearance="tint" className={styles.badge}>
                    {clip.asrModel.startsWith('faster-whisper') ? '本地转写' : '平台字幕'}
                  </Badge>
                )}
              </div>

              {/* 票面验收第 3 条：每一片都有可读的切分理由 */}
              <Text className={styles.reason}>{clip.reason ?? '（没有记录切分理由）'}</Text>

              {clip.transcriptExcerpt !== null && (
                <Text className={styles.excerpt}>{clip.transcriptExcerpt}</Text>
              )}

              <ClipPlayer clip={clip} />

              <div className={styles.actions}>
                <Button
                  as="a"
                  appearance="secondary"
                  size="small"
                  icon={<OpenRegular />}
                  href={clip.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  disabled={clip.sourceUrl.trim().length === 0}
                >
                  在源视频里看（从 {formatClipTime(clip.startSec)} 起）
                </Button>
              </div>

              {/* 票面验收第 7 条：产物可追溯 */}
              <Text className={styles.source}>
                来源：{clip.sourceUrl || clip.sourceNote || '来源链接未知'}
                {clip.uploadedBy !== null ? ` · ${clip.uploadedBy}` : ''}
                {clip.downloadedAt !== null ? ` · 下载于 ${clip.downloadedAt.slice(0, 10)}` : ''}
              </Text>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export { PlayRegular };
