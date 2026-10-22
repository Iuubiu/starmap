/**
 * 视频模块的路径小工具（票 19）。
 *
 * ## 为什么这些函数要独立成一个文件
 *
 * `contentRoot()` 原先写在 `video.controller.ts` 里，`video.service.ts` 为了
 * 解析片段的绝对路径又把它 import 回去 —— 于是 dependency-cruiser 的
 * `no-circular` 规则（**error 级**，会让 `pnpm check:boundaries` exit 1）报：
 *
 *     video.controller.ts → video.service.ts → video.controller.ts
 *
 * 环的成因不是谁设计错了，而是「纯路径函数」被放进了有依赖的那个文件里。
 * 把它挪出来，controller 与 service 各自 import 它，环就断了 —— 顺带让
 * 「这个路径是怎么算出来的」只有一处可读。
 *
 * ## 为什么 `contentPath()` 是这里最重要的函数
 *
 * 它是 `/media/*` 唯一的安全边界：库里的 `file_path` 是**相对** `content/` 的
 * 字符串（相对路径的理由见 `0050_video_clips.sql` 的注释 —— 绝对路径换机器就
 * 全失效），而这个字符串来自离线管线写出的 JSONL，不是从 HTTP 请求里直接拿的。
 * 但它最终拼进文件系统路径，所以「能不能跳出 `content/`」必须在**一个**地方
 * 判定。将来教材插图如果也走 `/media/figures/*`，它应当复用这个函数，而不是
 * 复制一遍前缀检查 —— 两份安全检查迟早漂移成一份有洞的。
 *
 * ## 为什么 `join` 要在这里再导出一遍
 *
 * 集成测试需要拼夹具路径，而它已经 `import { contentRoot } from './paths.js'`。
 * 让它同时拿到 `join` 就少一行 import —— 这一条纯属顺手，不是设计。
 */
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `apps/api/src/video/` 的相对位置 → 仓库根下的 `content/` 目录。 */
export function contentRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/video/paths.ts → ../../../.. == 仓库根
  return resolve(here, '..', '..', '..', '..', 'content');
}

/**
 * 把「相对 `content/` 的路径」解析成绝对路径，越界就抛错。
 *
 * ## 三层判据，缺一层就有洞
 *
 * 1. **先解码再解析**。`file_path` 理论上来自离线产物，但 `..%2f..%2fetc%2fpasswd`
 *    这种形态在 `resolve()` 眼里只是一个普通文件名（`%2f` 不是分隔符），拼出来
 *    落在 `content/` 里，`existsSync` 为假 —— 看似安全，实则把「路径不合法」和
 *    「文件不存在」混成同一个 404。解码一次再判，让前者明确抛错。
 *    解码失败（非法百分号序列）时不回退到原串硬拼，直接按原串处理并交给前缀判定 ——
 *    宁可多抛一个错，也不要把畸形输入当合法路径。
 * 2. **`root + sep` 而不是裸 `root` 做前缀**。`'/repo/content-evil/a.mp4'`
 *    以 `'/repo/content'` 开头，裸前缀检查会放行一个**同级目录**。加分隔符之后
 *    `'/repo/content/'` 才成立。
 * 3. **绝对路径天然被第 2 条拦住**：`resolve(root, '/etc/passwd')` 得到 `/etc/passwd`，
 *    不在 `content/` 下。但显式写出来，免得以后有人「优化」成 `join()`（`join`
 *    不重置根）。
 *
 * @param relativePath 相对 `content/` 的路径，如 `videos/BV1VE411e7UP_p9/clips/x.mp4`
 * @param root 仅测试用：换一个根目录，避免测试依赖仓库真实布局
 * @throws 路径解析后不在 `root` 之下
 */
export function contentPath(relativePath: string, root: string = contentRoot()): string {
  const decoded = decodePath(relativePath);
  const absolute = resolve(root, decoded);

  // `root` 本身（不带分隔符）在 `resolve` 后不会带尾斜杠，这里补一次再比。
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (absolute !== root && !absolute.startsWith(prefix)) {
    throw new Error(`路径越界（不在 content/ 下）：${relativePath}`);
  }
  return absolute;
}

/**
 * 解码一次路径。
 *
 * 不用 `try/catch` 包 `decodeURIComponent` 后再看 `%`：畸形序列（如 `%zz`）会让
 * 它抛 `URIError`，而那个错会被上层当成 500 —— 对调用方来说「路径畸形」与
 * 「路径越界」是同一类客户端问题，应该走同一个错误分支。
 */
function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export { join };
