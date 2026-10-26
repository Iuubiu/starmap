/**
 * 知识点搜索索引（票 07）：按名字子串或印刷页码查知识点。纯函数，
 * 不碰 DOM、不碰 React、不发请求——数据从 `GET /nodes` 全量列表来
 * （`api/queries/graph.ts` 的 `useAllNodes`），界面入口在「正在学」卡的
 * 「换个知识点」弹层。
 *
 * ## 为什么是朴素的线性扫描，而不是 trie / 倒排 / 正则
 *
 * 库里 enabled 约 4030 个节点。一次全表 `name.includes(q)` 是 4030 次字串
 * 比较，实测微秒级（`kp-index.test.ts` 的探针断言 < 200ms，留了一个多量级
 * 的余量防 CI 抖动）；页码路径同量级。这个规模下任何花活（预分词、后缀
 * 结构、每次查询前 normalize 全表）都是负优化——它们的收益要 10 万节点
 * 以上才出现，而它们的代价（建索引时间、内存、代码复杂度）现在就付。
 * M2（地图找点）直接复用本模块；真到十万量级再换实现，接口不变。
 *
 * ## 为什么结果保持列表顺序、不做得分排序
 *
 * 与 `roster-search.ts` 同一条纪律：列表顺序是语义顺序（服务端按主线排），
 * 按得分重排会让同一次查询的两次渲染顺序不稳定，键盘用户刚摸到位置就被
 * 换走。重名消歧靠结果项自带的 `sourceTitle`（哪本书的那一个），不靠次序。
 *
 * ## 纯数字输入的语义
 *
 * 印刷页码**精确相等**（`page === Number(q)`），不是前缀也不是范围：「12」
 * 只找第 12 页。页码跨书重复是常态（每本书都有第 12 页），命中多条时靠
 * `sourceTitle` 区分——这正是票面把书名塞进列表契约的原因。
 *
 * `sourceTitle` / `page` 的 null 语义来自契约（`NodeStateSchema`）：
 * null = 手工知识点（没有教材出处），不是「字段没实现」。手工点照样能被
 * 名字搜到，只是没有书名可消歧、没有页码可命中。
 */

/** 参与索引的最小形状。`NodeState`（生成客户端）满足它，测试可传更小的对象。 */
export interface KpIndexNode {
  readonly microKpId: string;
  readonly name: string;
  /** 书名（消歧用）。null = 手工知识点 */
  readonly sourceTitle: string | null;
  /** 印刷页码。null = 手工知识点 */
  readonly page: number | null;
}

/** 一条查询结果：够「显示 + 跳转」用的三样，多一个字段都不带。 */
export interface KpIndexHit {
  readonly microKpId: string;
  readonly name: string;
  readonly sourceTitle: string | null;
}

/**
 * 弹层一次最多渲染的结果数。「信号」「小结」这类名字在 4030 个节点里能
 * 命中几百条，全渲染成按钮会卡一帧；截断后弹层高度可控，输入一两个字后
 * 很快收敛。保持输入顺序截断（见模块头注释）。
 */
export const KP_INDEX_MAX_RESULTS = 50;

/** 纯数字（含全半角英文数字）才算页码查询；带任何别的字符都走名字子串。 */
const DIGITS_ONLY = /^\d+$/;

export interface KpIndex {
  /** 查询：空白 → 空数组；纯数字 → 页码精确命中；否则 → 名字子串。 */
  query(text: string): readonly KpIndexHit[];
  /** 索引里的节点总数（界面显示「共 N 个」用）。 */
  readonly size: number;
}

/**
 * 建索引。建的时候只拷贝四个字段（把调用方的大对象解开，防止调用方
 * 以为自己改 `nodes[0].name` 能影响后续查询），之后所有查询共享同一份
 * 拷贝——`query()` 永远不重建、不修改索引。
 */
export function createKpIndex(nodes: readonly KpIndexNode[]): KpIndex {
  const entries: KpIndexNode[] = nodes.map((node) => ({
    microKpId: node.microKpId,
    name: node.name,
    sourceTitle: node.sourceTitle,
    page: node.page,
  }));

  return {
    size: entries.length,

    query(text: string): readonly KpIndexHit[] {
      const q = text.trim();
      if (q === '') return [];
      /*
       * 全角数字（中文输入法在中文态直接敲数字键的默认产物）先归一成半角再判，
       * 否则「１２」过不了 DIGITS_ONLY，会掉进名字子串路径显示「没找到」。
       * 只归一判型与页码数值；名字子串仍用原串（节点名里若真有全角数字，
       * 按用户输入的原样匹配才对）。
       */
      const digits = q.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
      const byPage = DIGITS_ONLY.test(digits);
      const page = byPage ? Number(digits) : null;
      const hits: KpIndexHit[] = [];
      for (const node of entries) {
        const matched = byPage ? node.page !== null && node.page === page : node.name.includes(q);
        if (!matched) continue;
        hits.push({ microKpId: node.microKpId, name: node.name, sourceTitle: node.sourceTitle });
        if (hits.length >= KP_INDEX_MAX_RESULTS) break;
      }
      return hits;
    },
  };
}
