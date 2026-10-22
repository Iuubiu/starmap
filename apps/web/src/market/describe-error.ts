/**
 * 把 API 错误翻译成学生能读的一句话（票 67 的验收③④都要求「失败有可读错误」）。
 *
 * 为什么单独一个文件：模板面板、导出/导入面板、以及保存动作都要用它，
 * 三处各写一份会出现「预览说『字段 steps.2.itemIds.0』、保存说『校验失败』」
 * 这种同一个错误两种说法。
 *
 * ## 为什么要把 details 拼进来
 *
 * 后端 422 的 `message` 是**汇总句**（「关卡规范校验不通过（3 处）」），真正
 * 能修的信息在 `details` 里 —— 每一条是 `{path, message, code}`，path 细到
 * `steps[2].itemIds[0]`。只显示汇总句等于让用户自己猜是哪三处。400 的
 * details 是 Zod 形状错误，path 是点号路径（`format`、`items.0.answer`）。
 *
 * 拼接上限：只取前 3 条。一份被手改坏的导出文件可能有几十条错误，
 * 全列出来会把页面撑成一堵墙，而修完前几条之后重试还会再报剩下的。
 */
import { ApiClientError } from '../api/fetcher';

const MAX_DETAILS = 3;

function detailLine(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const path = (item as { path?: unknown }).path;
  const message = (item as { message?: unknown }).message;
  const hasPath = typeof path === 'string' && path.length > 0;
  const hasMessage = typeof message === 'string' && message.length > 0;
  if (hasPath && hasMessage) return `${path}：${message as string}`;
  if (hasPath) return path as string;
  if (hasMessage) return message as string;
  return null;
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiClientError) {
    const details = Array.isArray(error.details) ? error.details : [];
    const lines = details
      .map(detailLine)
      .filter((line): line is string => line !== null)
      .slice(0, MAX_DETAILS);
    if (lines.length === 0) return error.message;
    const suffix = details.length > MAX_DETAILS ? `（另有 ${details.length - MAX_DETAILS} 处未列出）` : '';
    return `${error.message}｜${lines.join('；')}${suffix}`;
  }
  if (error instanceof Error) return error.message;
  return '未知错误';
}
