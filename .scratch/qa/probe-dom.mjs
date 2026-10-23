/**
 * 票 87 辅助：把 HomePage / LearningPage 的结构层与关键盒子 dump 出来。
 *
 * 页面用 Fluent `makeStyles`（类名是哈希），没法按语义类名选，所以这里
 * 沿 DOM 走一遍，只打印「有实心背景 / 有圆角 / 有非零内边距」的节点，
 * 用来定位「主栏 / 消息气泡 / 关卡卡 / 右栏 / 输入条」各自的盒子。
 */
import { chromium } from '@playwright/test';

const APP = process.env.APP ?? 'http://localhost:5173';

const DUMP = `() => {
  const rows = [];
  const walk = (el, depth) => {
    if (depth > 14) return;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const bg = cs.backgroundColor;
    const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => parseFloat(v) || 0);
    const padSum = pad.reduce((a, b) => a + b, 0);
    const interesting = (opaque || radius > 0 || padSum > 0) && r.width > 40 && r.height > 20;
    if (interesting) {
      const label = (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName).slice(0, 34);
      rows.push({
        d: depth, tag: el.tagName.toLowerCase(), cls: label,
        x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        radius: cs.borderTopLeftRadius,
        pad: pad.join('/'),
        fs: cs.fontSize, lh: cs.lineHeight,
        bg: opaque ? bg : '',
        txt: (el.textContent || '').trim().slice(0, 18),
      });
    }
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(document.querySelector('.sm-main') || document.body, 0);
  return rows;
}`;

const browser = await chromium.launch();
for (const [name, url] of [['学习页', APP + '/'], ['学习记录页', APP + '/learning']]) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 700 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const rows = await page.evaluate(new Function('return ' + DUMP)());
  console.log(`\n========== ${name} ==========`);
  for (const r of rows) {
    console.log(
      `${'  '.repeat(r.d)}${r.tag}.${r.cls} | ${r.x},${r.y} ${r.w}x${r.h} r=${r.radius} pad=${r.pad} fs=${r.fs}/${r.lh} ${r.bg}${r.txt ? ' "' + r.txt + '"' : ''}`,
    );
  }
  await page.close();
}
await browser.close();
