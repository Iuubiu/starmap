import { describe, expect, it } from 'vitest';
import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';

/**
 * 图谱渲染依赖的**存在性**检查（不是渲染测试）。
 *
 * 票 03 的图谱画布要先证明这三块积木在当前依赖下真的能被装上并转起来，
 * 否则那条泳道会在写了两百行渲染代码之后才发现 sigma 4 换了选项形状。
 *
 * 这里只断言「能 import、能构造、能调用」，不碰 canvas —— jsdom 没有 WebGL
 * 上下文，`new Sigma()` 在浏览器里才跑得起来。真正的渲染验证归票 03 的
 * 端到端测试。
 *
 * 顺带锁住一件容易踩的事：sigma 4 把原来平铺在构造选项上的设置搬进了
 * `settings` 字段（`renderEdgeLabels` 等）。写成顶层会被类型检查拦下来，
 * 这个测试因此也是一份可执行的用法备忘。
 */
describe('图渲染依赖', () => {
  it('graphology 能建图并改属性', () => {
    const graph = new Graph();
    graph.addNode('a', { x: 0, y: 0, size: 4, label: 'A' });
    graph.addNode('b', { x: 1, y: 1, size: 4, label: 'B' });
    graph.addEdge('a', 'b');

    expect(graph.order).toBe(2);
    expect(graph.getNodeAttribute('a', 'label')).toBe('A');
  });

  it('forceatlas2 能算出坐标', () => {
    const graph = new Graph();
    graph.addNode('a', { x: 0, y: 0 });
    graph.addNode('b', { x: 1, y: 0 });
    graph.addEdge('a', 'b');

    forceAtlas2.assign(graph, { iterations: 5 });

    // 不验收具体数值（迭代算法不该被钉死），只要求跑完仍是有限数
    expect(Number.isFinite(graph.getNodeAttribute('a', 'x'))).toBe(true);
    expect(Number.isFinite(graph.getNodeAttribute('b', 'y'))).toBe(true);
  });

  it('sigma 的类型接受嵌套 settings 选项', () => {
    // 只做类型层面的断言：Sigma 的构造影子函数接受这样的选项对象。
    // 真渲染需要 WebGL，归票 03 的浏览器测试。
    const options: ConstructorParameters<typeof Sigma>[2] = {
      settings: { renderEdgeLabels: false, labelRenderedSizeThreshold: 6 },
    };
    expect(options.settings?.renderEdgeLabels).toBe(false);
  });
});
