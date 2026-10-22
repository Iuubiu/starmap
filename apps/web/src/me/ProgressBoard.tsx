/**
 * 个人看板（票 80）：知识点 / 学科 / 课本三级进度。
 *
 * ## 为什么三块共用一个响应
 *
 * 掌握度按半衰期衰减，三块各发一次请求就各取一个评估时刻，页面会出现
 * 「知识点说已掌握 7、八层加起来 6」这种自相矛盾。后端合成一个响应
 * （`GET /api/v1/mastery/board`），这里只发一次请求 —— 一致性是结构给的。
 *
 * ## 为什么空态不画一条 0% 的进度条
 *
 * 「0%」和「还没有数据」是两个不同的断言。刚注册的学生什么都没做，画一条
 * 0% 的条等于告诉他「你学了但都没学会」；而真相是**还没有任何证据**。
 * 所以没有证据时显示一句话，而不是把分母摆在一条空条上。
 *
 * ## 分母为什么必须显示
 *
 * 「掌握了 7 个」在没有分母时不是进度。3,085 个里的 7 个和 20 个里的 7 个
 * 是两种处境；只有百分比则把「库有多大」藏起来，学生无法判断还剩多远。
 */
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Badge, ProgressBar, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { ProgressBoard as ProgressBoardData } from '@starmap/api-contract';
import { useGetProgressBoard } from '../api/generated/mastery/mastery.js';

/**
 * 学科卡片的落点。
 *
 * 票面写的是 `/library` 的教材段，但仓库目前没有 `/library` 路由（教材/来源
 * 都在 `/database`）。这里指向真实存在的页面，并把缺口留在注释里：等 `/library`
 * 落地时只改这一个常量，不要在卡片里散落写死字符串。
 */
const LIBRARY_HREF = '/database';

/** `/` 是智能体学习台，`?kp=` 是它的焦点参数（票 56）。 */
const LEARN_HREF = '/';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  section: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '12px',
  },
  totalBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  numbers: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    color: tokens.colorNeutralForeground2,
  },
  // 三个数字要能一眼分开：数字大一点、词小一点，读屏按顺序读「已掌握 3」。
  numberValue: { fontSize: '18px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 168px) 1fr auto',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 0',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  rowName: { color: tokens.colorNeutralForeground1 },
  rowTrack: { display: 'flex', flexDirection: 'column', gap: '4px' },
  rowMeta: { color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums' },
  muted: { color: tokens.colorNeutralForeground3 },
  empty: {
    padding: '12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
  },
  disabledBooks: { display: 'flex', flexDirection: 'column', gap: '4px' },
  disabledRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  link: { color: tokens.colorBrandForegroundLink },
});

/**
 * 百分比保留两位小数：全库 3,085 个知识点时，掌握 1 个是 0.03% —— 四舍五入到
 * 整数会变成「0%」，看起来像「一个都没学」，那是假话。
 */
export function percentOf(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 10000) / 100;
}

/**
 * 看板三块。
 *
 * 独立组件而不是塞进 `MePage`：`/me` 左边是画像（输入），右边是看板（输出），
 * 两者数据源与失败模式都不同 —— 画像挂了不该让看板跟着空白。
 */
export function ProgressBoard(): React.JSX.Element {
  const styles = useStyles();
  const query = useGetProgressBoard();

  const board = useMemo(
    () => (query.data?.data as ProgressBoardData | undefined) ?? undefined,
    [query.data],
  );

  if (query.isPending) {
    return <Text className={styles.muted}>正在算你的进度…</Text>;
  }
  if (query.isError || board === undefined) {
    return (
      <Text className={styles.empty}>
        没读到看板：后端可能没连上。画像还能看，进度这里稍后再试。
      </Text>
    );
  }

  const kp = board.knowledgePoints;
  const hasEvidence = kp.mastered + kp.learning > 0;
  const totalPercent = percentOf(kp.mastered, kp.total);
  const enabledBooks = board.books.filter((book) => book.enabled);
  const disabledBooks = board.books.filter((book) => !book.enabled);

  return (
    <div className={styles.root}>
      <section className={styles.section} aria-label="总进度">
        {hasEvidence ? (
          <div className={styles.totalBar}>
            <ProgressBar
              value={kp.total === 0 ? 0 : kp.mastered / kp.total}
              thickness="large"
              aria-label={`已掌握 ${String(kp.mastered)} / ${String(kp.total)} 个知识点`}
            />
            <Text className={styles.rowMeta}>
              已掌握 {kp.mastered} / {kp.total}
              {totalPercent === null ? null : `（${String(totalPercent)}%）`}
            </Text>
          </div>
        ) : (
          <div className={styles.empty} data-testid="board-empty">
            你还没有任何作答记录，学完第一关后这里会出现数字。
          </div>
        )}
        <div className={styles.numbers}>
          <span>
            已掌握 <span className={styles.numberValue}>{kp.mastered}</span>
          </span>
          <span>
            在学 <span className={styles.numberValue}>{kp.learning}</span>
          </span>
          <span>
            未学 <span className={styles.numberValue}>{kp.untouched}</span>
          </span>
        </div>
      </section>

      <section className={styles.section} aria-label="知识点进度">
        <div className={styles.sectionHead}>
          <Text weight="semibold">知识点：全库 {kp.total} 个叶节点</Text>
          <Link className={styles.link} to={LEARN_HREF}>
            去学习台
          </Link>
        </div>
        {kp.byState.map((row) => (
          <div key={row.state} className={styles.row}>
            <Text className={styles.rowName}>{STATE_LABEL[row.state] ?? row.state}</Text>
            <ProgressBar
              value={kp.total === 0 ? 0 : row.count / kp.total}
              aria-label={`${STATE_LABEL[row.state] ?? row.state} ${String(row.count)} 个`}
            />
            <Text className={styles.rowMeta}>{row.count} 个</Text>
          </div>
        ))}
      </section>

      <section className={styles.section} aria-label="学科进度">
        <div className={styles.sectionHead}>
          <Text weight="semibold">学科：按课程层</Text>
          <Link className={styles.link} to={LIBRARY_HREF}>
            教材与来源
          </Link>
        </div>
        {board.layers.map((layer) => {
          const percent = percentOf(layer.mastered, layer.total);
          return (
            <div key={layer.id} className={styles.row}>
              <Text className={styles.rowName}>{layer.name}</Text>
              <div className={styles.rowTrack}>
                <ProgressBar
                  value={layer.total === 0 ? 0 : layer.mastered / layer.total}
                  aria-label={`${layer.name} 已掌握 ${String(layer.mastered)} / ${String(layer.total)}`}
                />
              </div>
              <Text className={styles.rowMeta}>
                {layer.mastered} / {layer.total}
                {percent === null ? '' : ` · ${String(percent)}%`}
              </Text>
            </div>
          );
        })}
        {board.unlayeredLeafCount === 0 ? null : (
          <Text className={styles.muted}>
            另有 {board.unlayeredLeafCount} 个知识点没归入任何课程层（如布尔代数、卡诺图化简），
            它们算在「知识点」那块的分母里，不在上面八层里。
          </Text>
        )}
      </section>

      <section className={styles.section} aria-label="课本进度">
        <div className={styles.sectionHead}>
          <Text weight="semibold">课本：{enabledBooks.length} 本在用</Text>
          <Link className={styles.link} to="/database">
            来源表
          </Link>
        </div>
        {enabledBooks.map((book) => {
          const percent = percentOf(book.learned, book.total);
          return (
            <div key={book.id} className={styles.row}>
              <Text className={styles.rowName}>{book.title}</Text>
              <ProgressBar
                value={book.total === 0 ? 0 : book.learned / book.total}
                aria-label={`${book.title} 已学 ${String(book.learned)} / ${String(book.total)}`}
              />
              <Text className={styles.rowMeta}>
                {book.learned} / {book.total}
                {percent === null ? '' : ` · ${String(percent)}%`}
              </Text>
            </div>
          );
        })}

        {disabledBooks.length === 0 ? null : (
          <div className={styles.disabledBooks}>
            <Text className={styles.muted}>
              另有 {disabledBooks.length} 本英文原版已停用（没有知识点指向它们）：
            </Text>
            {disabledBooks.map((book) => (
              <div key={book.id} className={styles.disabledRow}>
                <Badge appearance="tint" size="small">
                  已停用
                </Badge>
                <Text className={styles.muted}>{book.title}</Text>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** 五态中文名。与后端 `state` 枚举一一对应；未知值原样显示，不猜。 */
const STATE_LABEL: Record<string, string> = {
  mastered: '已掌握',
  proficient: '已熟练',
  familiar: '已熟悉',
  attempted: '刚接触',
  unseen: '未学习',
};
