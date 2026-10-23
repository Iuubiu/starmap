/**
 * 节点清单顶部的搜索框（票 86）。
 *
 * ## 为什么搜索框属于清单，而不是页面
 *
 * 「按名字找点」的落点是**清单**：清单本来就是画布的等价文本替代（见
 * `NodeRoster.tsx` 开头）。把搜索放进清单内部，地图页的 grid、相机、可见
 * 节点裁剪一行都不用动 —— 筛选只改变「清单显示哪几条」，不改变画布上「哪里
 * 有节点」。反过来说，如果搜索框做成地图页上的全局筛选，它就得同时驱动画布
 * 高亮与清单过滤，牵连 `MapPage` 的可见性计算，那是另一张票的事。
 *
 * ## 为什么输入框与「筛选出 N 个」在同一块里
 *
 * 命中数对搜索是**即时反馈**：学生输「knt」之后最想知道的是「到底有没有」，
 * 而这个答案是数字，不是列表长度（列表可能短到看不出是筛过还是本来就少）。
 * 所以数字跟着输入框走，并且用 `aria-live="polite"`：读屏用户每敲一个字都能
 * 听到结果数变化，不必先去数列表项。
 *
 * ## 为什么清除按钮不是「×」图标按钮
 *
 * 文字「清除」在 200px 宽、`font-size: 12px` 的清单里比图标更容易点中，也
 * 不依赖图标可访问名。Esc 也清空：搜索框是单行输入，Esc 的惯例就是「退出
 * 当前输入状态」，而这里退出 = 回到全部。
 */
import { useRef } from 'react';
import { isRosterQueryEmpty, rosterSearchStatus } from './roster-search.js';

export interface RosterSearchProps {
  /** 受控查询串（原样传入，归一化在 `roster-search.ts` 里做） */
  query: string;
  /** 查询变化。清空时传空串。 */
  onQueryChange: (query: string) => void;
  /** 清单里的知识点总数（筛选前） */
  total: number;
  /** 当前命中的条数 */
  matched: number;
}

export function RosterSearch({
  query,
  onQueryChange,
  total,
  matched,
}: RosterSearchProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const active = !isRosterQueryEmpty(query);

  const clear = (): void => {
    onQueryChange('');
    // 清空后把焦点还给输入框：键盘用户的下一步通常是重新输入，而不是回到
    // 清单顶部重新 Tab 一遍。
    inputRef.current?.focus();
  };

  return (
    <div className="graph-roster-search" data-roster-search-active={active ? 'true' : 'false'}>
      <label className="graph-roster-search-label" htmlFor="graph-roster-search-input">
        按名字找知识点
      </label>
      <div className="graph-roster-search-field">
        <input
          ref={inputRef}
          id="graph-roster-search-input"
          className="graph-roster-search-input"
          type="search"
          value={query}
          placeholder="中文名或拼音首字母，例如 knt"
          aria-label="按名字筛选知识点"
          aria-controls="graph-roster-list"
          aria-describedby="graph-roster-search-status"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && active) {
              // 不让 Esc 冒泡到窗口级快捷键（地图页没有，但别养成坏习惯）。
              event.preventDefault();
              event.stopPropagation();
              clear();
            }
          }}
        />
        {active && (
          <button type="button" className="graph-roster-search-clear" onClick={clear}>
            清除
          </button>
        )}
      </div>
      <p
        id="graph-roster-search-status"
        className="graph-roster-search-status"
        role="status"
        aria-live="polite"
        data-roster-matched={matched}
      >
        {rosterSearchStatus(total, matched, query)}
      </p>
    </div>
  );
}
