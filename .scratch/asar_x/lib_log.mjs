import fs from 'node:fs';
import zlib from 'node:zlib';

export const MAGIC = 4247762216;
export const CHECKSUM = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };

export function scanFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 12 <= buf.length) {
    const start = offset;
    try {
      if (buf.readUInt32LE(offset) !== MAGIC) throw new Error('magic at ' + offset);
      offset += 4;
      const d = buf.readUInt8(offset); offset += 1;
      const cs = d >>> 6, ss = (d & 32) !== 0, ck = (d & 4) !== 0, df = d & 3;
      const dict = df === 3 ? 4 : df;
      const csb = cs === 0 ? (ss ? 1 : 0) : (1 << cs);
      offset += (ss ? 0 : 1) + dict + csb;
      for (;;) {
        if (offset + 3 > buf.length) throw new Error('torn block header');
        const bh = buf.readUIntLE(offset, 3); offset += 3;
        const last = (bh & 1) !== 0, type = (bh >>> 1) & 3, size = bh >>> 3;
        if (type === 3) throw new Error('reserved block type');
        offset += type === 1 ? 1 : size;
        if (offset > buf.length) throw new Error('torn block body');
        if (last) break;
      }
      if (ck) { offset += 4; if (offset > buf.length) throw new Error('torn checksum'); }
    } catch (e) {
      return { frames, rest: buf.subarray(start) };
    }
    frames.push({ start, end: offset });
  }
  return { frames, rest: buf.subarray(offset) };
}

export function decodeBuffer(buf) {
  const { frames, rest } = scanFrames(buf);
  const frameLines = [];
  const rows = [];
  let badFrame = -1;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    let text;
    try { text = zlib.zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf8'); } catch { badFrame = i; break; }
    if (!text.endsWith('\n')) { badFrame = i; break; }
    const lines = text.slice(0, -1).split('\n');
    frameLines.push(lines.length);
    for (const l of lines) rows.push(l);
  }
  return { frames, frameLines, rows, rest, badFrame };
}

export function encodeRows(rows, frameLines) {
  const chunks = [];
  let idx = 0;
  for (const n of frameLines) {
    if (idx >= rows.length) break;
    const take = Math.min(n, rows.length - idx);
    const part = rows.slice(idx, idx + take).join('\n') + '\n';
    chunks.push(zlib.zstdCompressSync(Buffer.from(part, 'utf8'), CHECKSUM));
    idx += take;
  }
  while (idx < rows.length) {
    chunks.push(zlib.zstdCompressSync(Buffer.from(rows[idx] + '\n', 'utf8'), CHECKSUM));
    idx += 1;
  }
  return Buffer.concat(chunks);
}

export function msgOf(r) { const m = r.data && r.data.message; return typeof m === 'string' ? JSON.parse(m) : (m || {}); }

export function visibleChars(rows) {
  let n = 0;
  for (const line of rows) {
    const r = JSON.parse(line);
    if (r.type === 'assistant/message') {
      const m = msgOf(r);
      for (const b of m.content || []) {
        if (b.type === 'text') n += (b.text || '').length;
        if (b.type === 'tool-call') n += typeof b.arguments === 'string' ? b.arguments.length : JSON.stringify(b.arguments || {}).length;
      }
    } else if (r.type === 'tool/result') {
      for (const c of (msgOf(r).content || [])) if (c.type === 'text') n += (c.text || '').length;
    } else if (r.type === 'user/message') {
      for (const c of r.data.content || []) if (c.type === 'text') n += (c.text || '').length;
    }
  }
  return n;
}

export function writeAtomic(srcPath, buf, opts) {
  const backupDir = opts.backupDir;
  const st0 = fs.statSync(srcPath);
  const cur = fs.readFileSync(srcPath);
  if (cur.length !== st0.size) throw new Error('file changed while reading');
  if (opts.expectSize !== undefined && st0.size !== opts.expectSize) throw new Error('size drift');
  if (opts.expectMtimeMs !== undefined && st0.mtimeMs !== opts.expectMtimeMs) throw new Error('mtime drift');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = backupDir + '/auto-' + stamp + '.zstd';
  fs.writeFileSync(backupPath, cur);
  const files = fs.readdirSync(backupDir).filter((f) => f.startsWith('auto-')).sort();
  while (files.length > 10) { fs.unlinkSync(backupDir + '/' + files.shift()); }
  const tmp = srcPath + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.copyFileSync(tmp, srcPath);
  fs.unlinkSync(tmp);
  return { backupPath, bytes: buf.length };
}
