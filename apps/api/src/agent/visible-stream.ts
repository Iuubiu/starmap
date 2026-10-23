/**
 * 从「正在流式到达的 JSON 文本」里抽出 `visibleResponse` 字段的**已可用部分**。
 *
 * ## 为什么需要它（不这么做会出什么事）
 *
 * 模型的输出是**一个 JSON plan**，不是一段散文：
 *
 * ```json
 * {"visibleResponse":"吸收律说的是 A+AB=A。","artifact":{...}}
 * ```
 *
 * 如果直接把上游的 token 吐给浏览器，学生看到的会是
 * `{"visibleRespo` 这种天书。所以「像 chat 模型一样逐字涌现」在这里的真正
 * 含义是：**边解析边把 visibleResponse 这个字符串里已经确定的那段吐出去**。
 *
 * 难点在于流是任意切开的：可能切在 `\"` 转义中间（`\` 和 `"` 分属两个 chunk），
 * 也可能切在 `\u4e2d` 这种 Unicode 转义中间（只到了 `\u4e`）。
 * 这两种情况都**不能急着把半截当正文发出去**——`\` 和 `\u4e` 单独出现时
 * 还没有确定含义，先发就会在屏幕上留下一个错的字符，事后无法撤回。
 *
 * ## 返回什么
 *
 * 返回「这一帧相比上一帧，新确定了多少个正文字符」——调用方把它作为
 * `token` 事件发出去。返回值只会增长不会回退，调用方不必自己记录长度。
 */
export interface VisibleStreamState {
  /** 已经吐出去的正文（解码后的字符，不是原始 JSON 片段） */
  emitted: string;
}

export function initialVisibleState(): VisibleStreamState {
  return { emitted: '' };
}

const MARKER = '"visibleResponse"';

/**
 * 解码一段已经**确定完整**的 JSON 字符串片段（不含外层引号）。
 *
 * 只处理 JSON 字符串里合法的那几种转义；遇到不认识的转义就原样保留，
 * 因为在「还没收全」的意义上，猜一个含义比原样保留更容易出错。
 */
function decodeJsonFragment(fragment: string): string {
  let out = '';
  for (let i = 0; i < fragment.length; i += 1) {
    const ch = fragment[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = fragment[i + 1];
    if (next === undefined) break; // 结尾的孤立反斜线：留给下一帧
    switch (next) {
      case 'n':
        out += '\n';
        i += 1;
        break;
      case 't':
        out += '\t';
        i += 1;
        break;
      case 'r':
        out += '\r';
        i += 1;
        break;
      case 'b':
        out += '\b';
        i += 1;
        break;
      case 'f':
        out += '\f';
        i += 1;
        break;
      case '"':
        out += '"';
        i += 1;
        break;
      case '\\':
        out += '\\';
        i += 1;
        break;
      case '/':
        out += '/';
        i += 1;
        break;
      case 'u': {
        const hex = fragment.slice(i + 2, i + 6);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          // `\u4e` 这种：还不够四个十六进制位，整段留到下一帧
          return out;
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 5;
        break;
      }
      default:
        out += next;
        i += 1;
        break;
    }
  }
  return out;
}

/**
 * 输入**累积到目前为止的完整原始文本**（不是增量），返回本帧新增的可见正文。
 *
 * 传累积文本而不是增量，是为了让这个函数成为纯函数：同样的输入永远同样输出，
 * 调用方不需要维护「上一个 chunk 停在哪个状态」这种易错的隐含状态。
 */
export function takeVisibleDelta(raw: string, state: VisibleStreamState): string {
  const at = raw.indexOf(MARKER);
  if (at < 0) return '';

  // 跳过 marker 后面的 `:` 与空白，找到值的起始引号
  let i = at + MARKER.length;
  while (i < raw.length && (raw[i] === ' ' || raw[i] === ':' || raw[i] === '\n' || raw[i] === '\r' || raw[i] === '\t')) {
    i += 1;
  }
  if (i >= raw.length || raw[i] !== '"') return ''; // 值不是字符串（或还没到引号）
  i += 1; // 进入字符串内容

  // 扫描到未转义的结束引号；没扫到说明字符串还没收完，用到结尾为止
  let end = i;
  let closed = false;
  while (end < raw.length) {
    const ch = raw[end];
    if (ch === '\\') {
      end += 2; // 跳过被转义的字符
      continue;
    }
    if (ch === '"') {
      closed = true;
      break;
    }
    end += 1;
  }

  // 关键：把结尾处**可能还没收全**的转义退回去
  let safeEnd = Math.min(end, raw.length);
  const tail = raw.slice(i, safeEnd);
  const trailingSlash = /(^|[^\\])(\\\\)*\\$/.test(tail);
  if (!closed && trailingSlash) safeEnd -= 1;
  // `\u` 后面不足四位也算没收全
  const uMatch = /\\u[0-9a-fA-F]{0,3}$/.exec(raw.slice(i, safeEnd));
  if (!closed && uMatch) safeEnd -= uMatch[0].length;

  const decoded = decodeJsonFragment(raw.slice(i, safeEnd));
  if (decoded.length <= state.emitted.length) return '';
  const delta = decoded.slice(state.emitted.length);
  state.emitted = decoded;
  return delta;
}
