/**
 * 右栏「本档上限」卡（票 04 / spec T4，形状见 composer-b4.html 的
 * 「本档上限：一次最多推进 3 个新知识点」一行卡）。
 *
 * ## 为什么数字必须透传、前端不许写 2/3/4
 *
 * `limit` 是服务端从 `TIER_PARAMS[tier].sessionNewKpLimit` 算出来的
 * （P1=2 / P2=3 / P3=4）。前端复制这三个数 = 改档位表时「改了两处、只生效
 * 一处」的经典漂移（`api/queries/tier.ts` 头注释的纪律）。这里只做字符串拼接。
 *
 * ## deferred 为什么单独一句
 *
 * `deferred > 0` 说明还有推荐被上限挡在本次会话之外。不写出来，学生会以为
 * 看不到的那些被永久跳过了；写清楚「下次会话再开」，上限才是可理解的规则
 * 而不是静默截断。
 *
 * ## 与 agent/SessionPlanCard 的分工
 *
 * 那张卡挂在首页侧栏，带推荐列表；这张是学习档案栏的一行卡，只说上限与
 * 排队数。数据同源（`useTierSessionPlan`，react-query 会去重同 key 请求）。
 */
import { Caption1, Card, Text } from '@fluentui/react-components';
import { useTierSessionPlan } from '../api/queries/tier';

export function SessionLimitCard() {
  const { payload } = useTierSessionPlan();

  return (
    <Card className="sm-glass sm-study-card" data-study-session-limit>
      <Text weight="semibold" as="h3">
        本档上限
      </Text>
      {payload ? (
        <>
          <Caption1 className="sm-study-kp">{`一次最多推进 ${payload.limit} 个新知识点`}</Caption1>
          {payload.deferred > 0 && (
            <Caption1 className="sm-study-note">{`还有 ${payload.deferred} 个，下次会话再开`}</Caption1>
          )}
        </>
      ) : (
        /*
         * pending 与失败共用「—」：右栏其他卡（进度行的「证据不足」）的约定是
         * 「不知道就不显示数字」，这里同口径；侧栏是辅助区，不摆红色告警。
         */
        <Caption1 className="sm-study-kp">—</Caption1>
      )}
    </Card>
  );
}
