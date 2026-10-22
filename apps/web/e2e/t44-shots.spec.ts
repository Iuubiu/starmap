/**
 * t44 取证：三档缩放下的画布截图 + 像素统计，落 `.scratch/qa/shots/`。
 *
 * 为什么直接量截图像素：WebGL 画布读不回内容（`preserveDrawingBuffer` 默认
 * false），而往产品代码里塞调试钩子去暴露布局坐标会违反票 03 第 2 条
 * （画布与可访问层分离、不留后门）。截图是用户真正看到的东西，也正好满足
 * 票 44 验收第 1 条「非背景色像素 > 10000」。
 *
 * 指标口径（都在 860×480 的视口上）：
 *   - `nonBg`   与背景 `#12161C` 差超过 24 的像素数 —— 票面那条下限
 *   - `ink`     同上，但排除标签文字（灰白、三通道接近相等且很亮）
 *   - `blobs`   `ink` 的 4-连通分量数。**这是「能分辨出多少块」的保守下限**：
 *               相邻节点的抗锯齿边会连在一起，所以它 ≤ 真实可分辨节点数
 *   - `largest` 最大连通块占 `ink` 的比例 —— 接近 1 说明全糊成一坨
 *
 * 用法（在 apps/web 下）：
 *   PLAYWRIGHT_OUTPUT_DIR=../../.scratch/pw-graph-dev-2-<ts> npx playwright test e2e/t44-shots.spec.ts
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const READY = 60_000;
test.describe.configure({ timeout: 180_000 });

const SHOTS = path.resolve(process.cwd(), '../../.scratch/qa/shots');

interface Png {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}

/** 解码 8 位 RGB/RGBA 的 PNG（Playwright 截图就是这两种之一）。 */
function decodePng(buffer: Buffer): Png {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body.readUInt8(8);
      colorType = body.readUInt8(9);
      if (bitDepth !== 8) throw new Error(`不支持的位深 ${bitDepth}`);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`不支持的颜色类型 ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const rawByte = line[x]!;
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          value = rawByte + predictor;
          break;
        }
        default:
          throw new Error(`未知的 PNG 过滤器 ${filter}`);
      }
      current[x] = value & 0xff;
    }
    current.copy(out, y * stride);
    previous = current;
  }
  return { width, height, channels, data: out };
}

const BG: [number, number, number] = [18, 22, 28];

/**
 * 统计非背景像素与「节点块」的连通分量。
 *
 * 容差很关键：`tol` 取大（把抗锯齿的半透明边也算成墨迹）时，相邻节点的
 * 边缘会把整片连成一个巨块 —— 实测 `tol=30` 时最大块占 80.8%，看起来像
 * 「全糊成一坨」，但那只是抗锯齿。改成**只算接近纯节点色**（`tol=6`）后，
 * 同一张截图得到 3477 个连通块（5467 个节点），与肉眼看到的一致。
 *
 * 同理不能用「三通道接近」来排文字：节点色 `#5A6A80` 的 b − r = 38，
 * 先验边也是蓝灰，而标签文字是亮灰白，按 `tol` 对齐节点色时它们天然被排除。
 */
const NODE: [number, number, number] = [90, 106, 128];
const NODE_TOL = 6;

function measure(png: Png) {
  const { width, height, channels, data } = png;
  const total = width * height;
  const ink = new Uint8Array(total);
  let nonBg = 0;
  let inkPx = 0;
  for (let i = 0; i < total; i += 1) {
    const r = data[i * channels]!;
    const g = data[i * channels + 1]!;
    const b = data[i * channels + 2]!;
    const delta = Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]);
    if (delta > 24) nonBg += 1;
    if (Math.abs(r - NODE[0]) + Math.abs(g - NODE[1]) + Math.abs(b - NODE[2]) <= NODE_TOL) {
      ink[i] = 1;
      inkPx += 1;
    }
  }
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  let blobs = 0;
  let largest = 0;
  const push = (index: number): void => {
    seen[index] = 1;
    stack[top] = index;
    top += 1;
  };
  let top = 0;
  for (let start = 0; start < total; start += 1) {
    if (!ink[start] || seen[start]) continue;
    top = 0;
    push(start);
    let size = 0;
    while (top > 0) {
      top -= 1;
      const index = stack[top]!;
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x > 0 && ink[index - 1] && !seen[index - 1]) push(index - 1);
      if (x + 1 < width && ink[index + 1] && !seen[index + 1]) push(index + 1);
      if (y > 0 && ink[index - width] && !seen[index - width]) push(index - width);
      if (y + 1 < height && ink[index + width] && !seen[index + width]) push(index + width);
    }
    blobs += 1;
    if (size > largest) largest = size;
  }
  return {
    nonBg,
    inkPx,
    blobs,
    largestShare: inkPx === 0 ? 0 : largest / inkPx,
    nonBgShare: nonBg / total,
  };
}

interface Row {
  zoom: string;
  ratio: number;
  nodeCount: number;
  labels: number;
  nonBg: number;
  inkPx: number;
  blobs: number;
  largestShare: number;
  nonBgShare: number;
  screenshot: string;
}

test('t44：三档缩放下画布的可分辨节点块数与截图', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const canvas = page.locator('.graph-canvas');

  const open = async (): Promise<void> => {
    await page.goto('/map');
    await expect(canvas).toBeVisible({ timeout: READY });
    // 布局预算 4s，留余量等收敛
    await page.waitForTimeout(6_000);
  };

  const shoot = async (zoom: string): Promise<Row> => {
    await page.waitForTimeout(1_200);
    const ratio = Number(await canvas.getAttribute('data-camera-ratio'));
    const nodeCount = Number(await canvas.getAttribute('data-node-count'));
    const labels = Number(await canvas.getAttribute('data-labels-displayed'));
    const file = path.join(SHOTS, `t44-${zoom}.png`);
    // 只截画布本身：页面截图会把顶栏、清单也算进「非背景色像素」
    const buffer = await canvas.screenshot({ path: file });
    const stats = measure(decodePng(buffer));
    const row: Row = { zoom, ratio, nodeCount, labels, ...stats, screenshot: file };
    // eslint-disable-next-line no-console
    console.log(
      `${zoom.padEnd(5)} ratio=${ratio.toFixed(3)} nodes=${nodeCount} labels=${labels} ` +
        `nonBg=${stats.nonBg} (${(stats.nonBgShare * 100).toFixed(1)}%) ink=${stats.inkPx} ` +
        `blobs=${stats.blobs} largest=${(stats.largestShare * 100).toFixed(1)}%`,
    );
    return row;
  };

  const click = async (name: string, times: number): Promise<void> => {
    for (let i = 0; i < times; i += 1) {
      await page.getByRole('button', { name }).click();
      await page.waitForTimeout(150);
    }
  };

  const rows: Row[] = [];

  // 1x：默认视野（不做任何缩放）
  await open();
  rows.push(await shoot('1x'));

  // 0.2x：连点缩小
  await click('缩小图谱', 8);
  rows.push(await shoot('0.2x'));

  // 3x：重新打开页面（相机复位）后连点放大
  await open();
  await click('放大图谱', 8);
  rows.push(await shoot('3x'));

  fs.writeFileSync(path.join(SHOTS, '_map-probe.json'), JSON.stringify(rows, null, 2), 'utf8');

  const full = rows.find((row) => row.zoom === '1x')!;
  // 票 44 验收第 1 条的下限（只是下限，证明不了可读）
  expect(full.nonBg).toBeGreaterThan(10_000);
  expect(full.nodeCount).toBeGreaterThan(1_000);
  // 默认视野下应该已经画出可读标签（票面「冷加载 15s 内能认出 ≥5 个名称」）
  expect(full.labels).toBeGreaterThanOrEqual(5);
  // 不能糊成一整块：最大连通块不应吞掉一半以上的节点墨迹
  expect(full.largestShare).toBeLessThan(0.5);
  // 真正的可读性判据：默认视野下能分辨出上千个独立的节点块
  expect(full.blobs).toBeGreaterThan(1_500);
});
