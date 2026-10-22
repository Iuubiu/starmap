/** 两张「走丢了」时给人看的页面：404 兜底与渲染期异常。共用一套版式。 */
import { Button, Card, CardHeader, Text, Title3, Body1, makeStyles, tokens } from '@fluentui/react-components';
import { useLocation, useNavigate } from 'react-router';

const useStyles = makeStyles({
  /** 与其它页面同一套版式（padding 32 + 居中 + 880 上限），否则兜底页会顶到导航栏上。 */
  wrap: {
    padding: '32px',
    maxWidth: '880px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  body: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  actions: { display: 'flex', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    wordBreak: 'break-all',
  },
});

/**
 * 404 兜底。
 *
 * 为什么必须有：没有 `path: '*'` 时，React Router 会自己渲染它内置的
 * 开发者错误页 —— 一整屏英文 +「💿 Hey developer 👋」。学生改错一个字符的
 * URL 就会撞见它，那不是产品该给人的第一反应。这里换成中文说明 + 两个出口。
 */
export function NotFoundPage() {
  const s = useStyles();
  const navigate = useNavigate();
  // 用路由自己的 location 而不是 window.location：两者在正常浏览器里一致，
  // 但只有前者能在测试的 MemoryRouter 下反映「撞上的是哪个地址」。
  const here = useLocation().pathname;
  return (
    <div className={s.wrap}>
      <Card>
        <CardHeader header={<Title3>这一页不存在</Title3>} />
        <div className={s.body}>
          <Body1>
            地址可能打错了一个字，或者这个知识点/关卡已经被内容库重新生成过，旧链接失效了。
          </Body1>
          <Text className={s.code}>{here}</Text>
          <div className={s.actions}>
            <Button appearance="primary" onClick={() => navigate('/board')}>
              回看板
            </Button>
            <Button onClick={() => navigate('/map')}>打开知识地图</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/**
 * 渲染期异常兜底（`errorElement`）。
 *
 * 与 404 分开：这里是「页面炸了」，要如实说炸了并给出原始信息，而不是假装
 * 页面不存在 —— 学生拿着那句话才能回来告诉我哪里坏了。
 */
export function RouteErrorPage({ error }: { error?: unknown }) {
  const s = useStyles();
  const navigate = useNavigate();
  const message = error instanceof Error ? error.message : String(error ?? '未知错误');
  return (
    <div className={s.wrap}>
      <Card>
        <CardHeader header={<Title3>这一页出错了</Title3>} />
        <div className={s.body}>
          <Body1>页面在渲染时抛了异常。数据可能没坏，刷新或换个入口通常能继续。</Body1>
          <Text className={s.code}>{message}</Text>
          <div className={s.actions}>
            <Button appearance="primary" onClick={() => navigate('/board')}>
              回看板
            </Button>
            <Button onClick={() => window.location.reload()}>刷新这一页</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
