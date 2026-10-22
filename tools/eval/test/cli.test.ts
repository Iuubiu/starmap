import { describe, expect, it } from 'vitest';
import { makeRunId, parseArgs, USAGE } from '../src/cli.ts';

/**
 * 参数解析的单测。
 *
 * 这里断言的不是「能解析出对象」——那是显然的。断言的是**四种会被静默吞掉的
 * 输入**：打错的参数名、越界的 persona、缺值的选项、以及 `--help`。
 * 前三种如果被静默忽略，跑出来的报告上写着「P1」而实际跑的是默认 all，
 * 只有人眼能发现。第四种原来走异常路径，`--help` 打出的是 Node 堆栈。
 */

describe('parseArgs', () => {
  it('默认跑 all，且默认不打开 help', () => {
    const options = parseArgs([]);
    expect(options.persona).toBe('all');
    expect(options.help).toBe(false);
    expect(options.useJudge).toBe(true);
  });

  it('--persona 大小写不敏感；越界取值直接报错并列出合法值', () => {
    expect(parseArgs(['--persona', 'p2']).persona).toBe('P2');
    expect(() => parseArgs(['--persona', 'P4'])).toThrow(/只接受 P1 \/ P2 \/ P3 \/ all/);
  });

  it('不认识的参数直接报错，不静默忽略成默认值', () => {
    expect(() => parseArgs(['--person', 'P1'])).toThrow(/不认识的参数「--person」/);
  });

  it('选项缺少值时立即报错，而不是把下一个选项当成值', () => {
    expect(() => parseArgs(['--persona'])).toThrow(/需要一个值/);
    expect(() => parseArgs(['--base-url', '--persona', 'P1'])).toThrow(/需要一个值/);
  });

  it('--help 是一条正常路径：置 help=true 且不抛异常', () => {
    /* 原来这里 `throw`，于是 `--help` 退出码 2 并打出 Node 堆栈。帮助不是异常。 */
    const options = parseArgs(['--help']);
    expect(options.help).toBe(true);
    const short = parseArgs(['-h']);
    expect(short.help).toBe(true);
  });

  it('USAGE 里写的是能跑的命令，不是 pnpm 的内建子命令', () => {
    /*
     * `pnpm --filter <pkg> run -- ...` 会报 ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT ——
     * `run` 是 pnpm 自己的子命令。这条断言保证用法文本不会再退回去。
     */
    expect(USAGE).toContain('pnpm --filter @starmap/eval eval');
    expect(USAGE).not.toContain('eval run --');
  });

  it('--no-judge 关掉层③，--output 与 --model 被接住', () => {
    const options = parseArgs(['--no-judge', '--output', '.scratch/x', '--model', 'm-1']);
    expect(options.useJudge).toBe(false);
    expect(options.outputRoot).toBe('.scratch/x');
    expect(options.llmModel).toBe('m-1');
  });
});

describe('makeRunId', () => {
  it('同一时刻不同 persona 的 run-id 不撞，且可按时间排序', () => {
    const now = new Date(2026, 9, 21, 12, 42, 50);
    expect(makeRunId('P1', now)).toBe('20261021-124250-p1');
    expect(makeRunId('all', now)).toBe('20261021-124250-all');
    expect(makeRunId('P1', new Date(2026, 9, 21, 12, 42, 51)) > makeRunId('P1', now)).toBe(true);
  });
});
