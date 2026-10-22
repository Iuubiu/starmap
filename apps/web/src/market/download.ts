/**
 * 把导出文件写成浏览器下载（票 67 验收④）。
 *
 * ## 为什么抽成独立模块而不是写在页面里
 *
 * jsdom 没有 `URL.createObjectURL` / `revokeObjectURL`，页面里直接调用它就必须
 * 在测试里打桩 —— 打桩之后断言的是桩，不是「文件名与内容对得上」这个真问题。
 * 抽出来之后：
 *   - 文件名规则是纯函数（`exportFileName`，在 `queries/levels.ts` 里），可单测；
 *   - 本模块只做「Blob → a[download] → click」这一件事，E2E 里真跑一次即可；
 *   - 页面的测试可以注入一个假的 `download`，专心断言「点了导出按钮之后
 *     请求发给了哪个 levelId、拿到的内容有没有被原样交给下载」。
 *
 * ## 为什么要 `revokeObjectURL`
 *
 * 每次导出都 new 一个 blob URL，不 revoke 就一直挂在 document 上，直到页面
 * 关闭。一次会话里导出十几关不算多，但这是零成本就能避免的泄漏。
 * `setTimeout(..., 0)` 是因为 click 之后浏览器要异步读这个 URL，立即 revoke
 * 会让下载变成 0 字节（Chrome 上实测过）。
 */
import type { LevelExportFile } from '../api/generated/model';
import { exportFileName } from '../api/queries/levels';

export function downloadLevelFile(file: LevelExportFile): void {
  const json = `${JSON.stringify(file, null, 2)}\n`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFileName(file);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 读用户选的文件并解析成导出体。
 *
 * 这里**只**做 JSON 解析，不做形状校验 —— 形状与内容的校验都在服务端
 * （400 形状 / 422 内容，两套不同的错误码与 details）。前端先校验一遍会
 * 变成第二套真源，而且两边的判据一旦漂移，用户会看到「前端说没问题、
 * 后端拒收」这种最难查的错。
 *
 * 解析失败单独给一句人话：用户选的可能是任意文件，`JSON.parse` 的原始
 * 报错（`Unexpected token < in JSON at position 0`）对学习者没有意义。
 */
export async function readLevelFile(file: File): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    return {
      ok: false,
      message: `读不出这个文件：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: '这个文件不是 JSON，不像是导出的关卡文件（应以 .level.json 结尾）。' };
  }
}
