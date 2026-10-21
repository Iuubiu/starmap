/**
 * 「本次会话新知识点」卡片（票 12 的第四维参数）。
 *
 * ## 这一维为什么必须做成看得见的东西
 *
 * 另外五维都在关卡里直接可见（讲解形态、尝试次数、反馈时机、掌握判定、
 * 追问阶梯）。只有「单次会话新知识点上限」是**策略**而不是渲染参数：它约束的
 * 是「一次会话最多推进几个新知识点」。如果只在服务端算完丢掉，这一维就退回
 * 成「只存在数据库里的数字」——票 12 验收 1 明确不接受这种状态。
 *
 * 所以这张卡片把三件事摊开：
 *   1. 本档上限是几个（`limit`）；
 *   2. 现在按推荐顺序排在前面的都是哪几个（`items`）；
 *   3. 超出上限的那些**没有消失**，而是排队（`deferred`）——这一点很重要：
 *      如果不写，学生会以为系统只认这几条，看不到的就被永久跳过了。
 *
 * ## 为什么上限值不写在这里
 *
 * `limit` 是服务端从 `TIER_PARAMS[tier].sessionNewKpLimit` 算出来的。前端
 * 不复制 2/3/4（理由见 `api/queries/tier.ts` 的文件头）：改了参数表却只生效
 * 在服务端，界面就会开始骗人。
 *
 * ## 为什么没有「开始学这个」按钮
 *
 * 点一下就去学一个知识点听起来顺手，但那要新开一条「直接跳进关卡」的路径，
 * 而这个项目里进入关卡的路径（知识点页 → 关卡）已经带着前置门控。绕过它
 * 等于在界面上开一个后门。这里只负责说清「这一档给你排了哪几个」。
 */
import {
  Badge,
  Caption1,
  Card,
  CardHeader,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useTierSessionPlan } from '../api/queries';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px 16px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    margin: 0,
    paddingLeft: '18px',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    flexWrap: 'wrap',
  },
  subtle: { color: tokens.colorNeutralForeground3 },
});

export function SessionPlanCard() {
  const styles = useStyles();
  const plan = useTierSessionPlan();

  if (plan.isPending) {
    return (
      <Card className={styles.card}>
        <Spinner label="正在算这一档的会话上限…" />
      </Card>
    );
  }

  /**
   * 读不到就整块不渲染。
   *
   * 与 `EvidencePanel` / `TierHistoryCard` 的处理不同（那两处要报错），因为
   * 这张卡是**辅助信息**：它出错时学习本身不受影响，而侧栏里多一条红色告警
   * 会让人以为「现在不能学了」。宁可少一块。
   */
  if (plan.isError || !plan.payload) return null;

  const { limit, items, deferred } = plan.payload;

  return (
    <Card className={styles.card}>
      <CardHeader
        header={
          <Text weight="semibold">
            本次会话新知识点
          </Text>
        }
        description={
          <Caption1 className={styles.subtle}>
            {`按 ${plan.payload.tier} 档，一次最多推进 ${limit} 个新知识点。`}
          </Caption1>
        }
      />

      {items.length === 0 ? (
        <Caption1 className={styles.subtle}>
          当前没有待学的新知识点——先把手上这个学完。
        </Caption1>
      ) : (
        <ul className={styles.list} aria-label="本档排在前面的新知识点">
          {items.map((item) => (
            <li key={item.microKpId}>
              <span className={styles.row}>
                <Text size={300}>{item.name}</Text>
                {item.hasLevel ? (
                  <Badge appearance="tint" color="brand" size="small">
                    有现成关卡
                  </Badge>
                ) : (
                  <Badge appearance="outline" size="small">
                    还没有关卡
                  </Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {deferred > 0 && (
        <MessageBar intent="info">
          <MessageBarBody>
            {`还有 ${deferred} 个知识点排在后面：这一档一次只开 ${limit} 个，学完一个就往前挪一个。`}
          </MessageBarBody>
        </MessageBar>
      )}
    </Card>
  );
}
