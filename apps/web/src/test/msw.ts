import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * MSW 打桩层：让组件测试跑在**真实的 fetch** 上。
 *
 * 与「mock 掉 query hook」的分工：
 * - mock query hook → 测渲染决策（NodeDetailPage.test.tsx 用这个）
 * - MSW → 测「请求发出去了、形状对了、错误被正确翻译成 UI 状态」
 *
 * 两者都要有。只 mock hook 会漏掉「URL 拼错」「错误码没映射」这类真实故障。
 */
export const handlers = [
  http.get('*/api/v1/health', () =>
    HttpResponse.json({
      status: 'ok',
      dbNow: '2026-10-20T04:00:00.000Z',
      version: '0.1.0',
    }),
  ),

  http.get('*/api/v1/nodes', () =>
    HttpResponse.json({
      items: [
        { microKpId: 'kp-bool', name: '布尔代数基本运算', state: 'familiar', percent: 0.66, depth: 1 },
        { microKpId: 'kp-kmap', name: '卡诺图化简', state: 'unseen', percent: null, depth: 1 },
      ],
      nextCursor: null,
    }),
  ),

  http.get('*/api/v1/nodes/:id', ({ params }) => {
    if (params.id === 'kp-missing') {
      return HttpResponse.json({ code: 'NOT_FOUND', message: '知识点不存在' }, { status: 404 });
    }
    return HttpResponse.json({
      node: {
        microKpId: params.id,
        name: '布尔代数基本运算',
        state: 'familiar',
        percent: 0.66,
        depth: 1,
      },
      levels: [
        {
          levelId: 'lv-1',
          microKpId: params.id,
          title: '布尔代数的三条基本律',
          itemCount: 1,
          kind: 'teach',
        },
      ],
      reasons: ['已建立基础，还没有稳定，适合做变式练习。'],
    });
  }),
];

export const server = setupServer(...handlers);
