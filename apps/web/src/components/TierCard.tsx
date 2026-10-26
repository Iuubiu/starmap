/**
 * 右栏「当前档位」卡（票 02 / spec T2）。
 *
 * ## 为什么这张卡里没有半个按钮
 *
 * 档位是定级与学习证据的**结论**，不是设置项（`api/queries/tier.ts` 头注释：
 * 契约里根本没有 POST/PATCH——写接口就是绕过证据改档位的后门）。所以这里
 * 只有读：pill + 展示名 + 来源说明。「想升档」的答案是去作答，不是点下拉框。
 *
 * ## fallback 态的措辞纪律
 *
 * `source='fallback'` 时 `tier` 是 P1（默认档），但界面**不许**说「你的水平是
 * P1」——那是在把「我们还不知道」包装成「你是零基础」。话术固定为
 * 「还没定级，先按完整样例档教」。`placement` 才说「由定级测得」。
 *
 * ## 不在这里出现的数字
 *
 * 判定依据句（「由 3 次作答判定 · 连对 1/2」）属票 06：等契约加了 `basis`
 * 字段再渲染，这里不编数字。
 */
import { Badge, Caption1, Card, Text } from '@fluentui/react-components';
import { useTierOverview } from '../api/queries/tier';

export function TierCard() {
  const { payload } = useTierOverview();

  return (
    <Card className="sm-glass sm-study-card" data-study-tier>
      <div className="sm-study-tier-head">
        <Text weight="semibold" as="h3">
          当前档位
        </Text>
        {payload && (
          <Badge appearance="outline" data-tier-pill={payload.tier}>
            {payload.tier}
          </Badge>
        )}
      </div>
      {payload ? (
        <>
          <Caption1 className="sm-study-kp">{payload.label}</Caption1>
          <Caption1 className="sm-study-kp">
            {payload.source === 'placement' ? '由定级测得' : '还没定级，先按完整样例档教'}
          </Caption1>
          <Caption1 className="sm-study-note">档位是测量结果，不能自选。</Caption1>
        </>
      ) : (
        /*
         * pending 与失败共用一句占位：侧栏是辅助信息区，读不到档位不该红错，
         * 也不该把「正在读」与「读不到」分说成两种告警——那会比问题本身更吵。
         * （读不到时渲染参数仍按服务端默认档生效，这句话与事实一致。）
         */
        <Caption1 className="sm-study-kp">档位暂时读不到，先按默认档。</Caption1>
      )}
    </Card>
  );
}
