/**
 * `contentPath()` 的边界测试（票 19 收尾核查）。
 *
 * ## 为什么这个函数值得单独一个测试文件
 *
 * 它是 `/media/clips/:clipId` 唯一的安全边界：库里的 `file_path` 最终拼成
 * 文件系统路径并交给 `createReadStream`。越界只要漏一次，`GET /media/clips/x`
 * 就能读到 `content/` 之外的任意文件（`app.video_clips.file_path` 是文本列，
 * 任何能写这一列的人都能利用它）。
 *
 * 现有集成测试只覆盖了「文件不在盘上 → 404」，没有覆盖「路径逃逸 → 抛错」——
 * 因为造那条数据要往库里塞 `../../etc/passwd`，而 `resolveClipPath()` 抛的是
 * 普通 `Error`（500），不适合混在 HTTP 契约测试里。所以在这里用**注入的
 * root** 单测：不碰真库、不依赖仓库真实布局，跑得也快。
 *
 * 三种形态必须都盖住（票面点名了前两种）：
 * - 明文 `../`：`videos/../../etc/passwd`
 * - 百分号编码 `..%2f`：解码前不是分隔符，`resolve()` 看不出它是穿越
 * - 绝对路径：`/etc/passwd`（`resolve()` 遇到绝对路径会**重置**根）
 * - 额外一条：`content` 的**同级目录**（`content-evil/`）—— 裸前缀检查会放行
 */
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentPath, contentRoot } from './paths.js';

/**
 * 假根目录。
 *
 * 必须用 `resolve()` 造：`join(sep, 'tmp', 'x')` 在 Windows 上得到的是
 * `\tmp\x`（有根无盘符），而 `contentPath` 内部的 `resolve(root, rel)` 会把它
 * 落到**当前盘**上（`D:\tmp\x\...`）—— 两者前缀永远对不上，测试会误报「越界」。
 * 这不是 `contentPath` 的 bug，是夹具造了个不存在的路径形态。
 */
const ROOT = resolve('starmap-test-content');

describe('contentPath', () => {
  it('正常相对路径拼成 root 之下的绝对路径', () => {
    expect(contentPath('videos/BV1VE411e7UP_p9/clips/c01.mp4', ROOT)).toBe(
      join(ROOT, 'videos', 'BV1VE411e7UP_p9', 'clips', 'c01.mp4'),
    );
  });

  it('明文 `../` 逃逸必须抛错', () => {
    expect(() => contentPath('../../etc/passwd', ROOT)).toThrow(/路径越界/);
  });

  it('`..%2f` 百分号编码逃逸必须抛错', () => {
    // 关键：`resolve()` 不认 `%2f`，不先解码的话它会当成普通文件名，
    // 拼出的路径落在 root 之内 → 前缀检查放行 → 变成 404 而不是抛错。
    expect(() => contentPath('..%2f..%2fetc%2fpasswd', ROOT)).toThrow(/路径越界/);
  });

  it('绝对路径必须抛错（不能因为 resolve 重置根而落到 root 外）', () => {
    expect(() => contentPath('/etc/passwd', ROOT)).toThrow(/路径越界/);
  });

  it('root 的同级目录必须抛错（裸前缀检查会漏）', () => {
    // `'/tmp/starmap-test-content-evil/x.mp4'` 以 `'/tmp/starmap-test-content'`
    // 开头 —— 这正是 `root + sep` 而不是裸 `root` 做前缀的理由。
    expect(() => contentPath('../starmap-test-content-evil/x.mp4', ROOT)).toThrow(/路径越界/);
  });

  it('解析回 root 本身是允许的（但不是可读文件，由调用方判）', () => {
    expect(contentPath('.', ROOT)).toBe(ROOT);
  });

  it('畸形百分号序列不会让解码抛 URIError（按原串处理，仍受前缀检查）', () => {
    // `%zz` 不是合法转义。`decodeURIComponent` 会抛，这里必须吞掉并继续走前缀判定，
    // 否则同一个「客户端路径非法」会在 500 与 400 之间随机跳。
    expect(contentPath('videos/%zz.mp4', ROOT)).toBe(join(ROOT, 'videos', '%zz.mp4'));
    // 注意：`..%zz/../etc/passwd` **不**会逃逸 —— `..%zz` 是个普通目录名，
    // 紧接着的 `..` 把它抵消回到 root，最终仍是 `root/etc/passwd`。这不是漏洞，
    // 是 `resolve` 对未解码串的正常行为；所以逃逸用例要用真实的 `..` 层数。
    expect(() => contentPath('..%zz/../../etc/passwd', ROOT)).toThrow(/路径越界/);
  });

  it('contentRoot() 指向仓库根下的 content/', () => {
    expect(contentRoot().endsWith(`${sep}content`)).toBe(true);
  });
});
