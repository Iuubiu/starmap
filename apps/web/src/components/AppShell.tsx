import { Outlet, useLocation, useNavigate } from 'react-router';
import {
  makeStyles,
  tokens,
  TabList,
  Tab,
  Text,
  Spinner,
} from '@fluentui/react-components';
import { useHealth } from '../api/queries';

const useStyles = makeStyles({
  root: {
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    height: '100vh',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    padding: '0 24px',
    height: '48px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  brand: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    letterSpacing: '0.02em',
  },
  status: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: tokens.colorNeutralForeground3,
  },
  main: {
    overflow: 'auto',
  },
});

/**
 * 应用外壳：顶栏 + 内容区。
 *
 * 顶栏故意只有 48px 且信息极少 —— 学习工作台的主体是屏幕中央的产物，
 * 不是导航。健康状态放在右上角，因为它验证的正是「后端真的连上了数据库」
 * 这条最小闭环（票 01 的验收要求）。
 */
export function AppShell() {
  const styles = useStyles();
  const location = useLocation();
  const navigate = useNavigate();
  const health = useHealth();

  const selected = location.pathname.startsWith('/map')
    ? '/map'
    : location.pathname.startsWith('/market')
      ? '/market'
      : location.pathname.startsWith('/database')
        ? '/database'
        : location.pathname.startsWith('/skills')
          ? '/skills'
          : '/';

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Text className={styles.brand}>StarMap</Text>
        <TabList
          selectedValue={selected}
          onTabSelect={(_, data) => {
            navigate(data.value as string);
          }}
        >
          <Tab value="/">看板</Tab>
          <Tab value="/map">知识地图</Tab>
          <Tab value="/market">关卡市场</Tab>
          <Tab value="/database">数据库</Tab>
          <Tab value="/skills">技能库</Tab>
        </TabList>
        <div className={styles.status}>
          {health.isPending && <Spinner size="extra-tiny" />}
          {health.isError && <Text size={200}>后端未连接</Text>}
          {health.payload && (
            <Text size={200}>数据库 {health.payload.dbNow.slice(11, 19)}</Text>
          )}
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

