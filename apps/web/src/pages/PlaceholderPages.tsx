import {
  Text,
  Body1,
  Button,
  Card,
  CardHeader,
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { useNavigate } from 'react-router';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '860px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  heading: { display: 'flex', flexDirection: 'column', gap: '8px' },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
});

/**
 * 页面骨架：尚未实现业务逻辑的占位页。
 *
 * 为什么要先有骨架：六个页面的路由在票 01 就定下来，后面每票只填内容不改路由。
 * 占位页要能说清「这页将来干什么、现在为什么是空的」，而不是一句「建设中」——
 * 后者对使用者毫无信息量。
 */
export function PlaceholderPage({
  title,
  purpose,
  emptyReason,
  ticket,
}: {
  title: string;
  purpose: string;
  emptyReason: string;
  ticket: string;
}) {
  const styles = useStyles();
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          {title}
        </Text>
        <Body1>{purpose}</Body1>
      </div>

      <Card>
        <CardHeader header={<Text weight="semibold">当前状态</Text>} />
        <MessageBar>
          <MessageBarBody>
            {emptyReason}（由{ ticket }实现）
          </MessageBarBody>
        </MessageBar>
      </Card>

      <div>
        <Button onClick={() => navigate('/')}>返回看板</Button>
      </div>
    </div>
  );
}

export function SkillsPage() {
  return (
    <PlaceholderPage
      title="技能库"
      purpose="列出随应用打包的教学技能，可以看到每个技能的触发条件与版本，并启用或禁用。禁用会真正影响智能体行为，不只是隐藏界面。"
      emptyReason="技能库列表尚未实现。"
      ticket="票 15"
    />
  );
}
