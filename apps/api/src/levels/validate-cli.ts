/**
 * 关卡规范校验器的命令行入口。
 *
 * 票 04 验收 1 要的是「`level.spec.json` 校验器存在；非法关卡被拒绝并给出**字段级**
 * 错误信息」。校验逻辑在 `@starmap/shared` 的 `validateLevelSpec`（纯函数，前后端
 * 共用同一份），这个文件只是把它包一层命令行 —— 因为写关卡的是**人**，人会跑
 * `npx tsx src/levels/validate-cli.ts content/levels/` 而不是先写一段测试。
 *
 * 用法：
 *   npx tsx src/levels/validate-cli.ts content/levels/           # 整个目录
 *   npx tsx src/levels/validate-cli.ts content/levels/a.json     # 单个文件
 *   npx tsx src/levels/validate-cli.ts --json content/levels/    # 机器可读
 *
 * 退出码：全部合法 0；有任何一个不合法 1；用法错误 2。
 * 之所以给退出码而不是只打日志：这样它能进 CI、也能被 git hook 调。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { prettyIssuePath, validateLevelSpec } from '@starmap/shared';

interface FileResult {
  file: string;
  ok: boolean;
  issues: { path: string; prettyPath: string; message: string }[];
}

/**
 * 把命令行给的目标展开成文件清单。
 *
 * 目录按扩展名收 `.json`；单文件不看扩展名（人明确点了它，就验它）。
 * 目录不存在时抛错而不是静默返回空 —— 静默会把「路径打错」变成「零个文件，
 * 全部通过」。
 */
function collectFiles(targets: readonly string[]): string[] {
  const files: string[] = [];
  for (const target of targets) {
    const absolute = resolve(target);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      throw new Error(`路径不存在：${target}`);
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (extname(name) !== '.json') continue;
        files.push(join(absolute, name));
      }
    } else {
      files.push(absolute);
    }
  }
  return files;
}

function validateFile(file: string): FileResult {
  const shown = relative(process.cwd(), file).replaceAll('\\', '/');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      file: shown,
      ok: false,
      issues: [
        {
          path: '',
          prettyPath: '（根）',
          message: `不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = validateLevelSpec(raw);
  if (result.ok) return { file: shown, ok: true, issues: [] };
  return {
    file: shown,
    ok: false,
    issues: result.issues.map((issue) => ({
      path: issue.path,
      prettyPath: prettyIssuePath(issue.path),
      message: issue.message,
    })),
  };
}

function main(argv: readonly string[]): number {
  const asJson = argv.includes('--json');
  const targets = argv.filter((arg) => !arg.startsWith('--'));

  if (targets.length === 0) {
    console.error('用法：tsx src/levels/validate-cli.ts [--json] <关卡文件或目录> ...');
    return 2;
  }

  let files: string[];
  try {
    files = collectFiles(targets);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (files.length === 0) {
    console.error('目标里没有 .json 文件 —— 是路径打错了吗？');
    return 2;
  }

  const results = files.map(validateFile);

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      if (result.ok) {
        console.log(`✓ ${result.file}`);
        continue;
      }
      console.error(`✗ ${result.file}`);
      for (const issue of result.issues) {
        // 字段级路径是这一行最要紧的部分，单独用方括号形式渲染（steps[2].itemIds[0]）。
        console.error(`    ${issue.prettyPath}：${issue.message}`);
      }
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (!asJson) {
    console.log(
      failed.length === 0
        ? `\n全部通过（${results.length} 个文件）`
        : `\n${failed.length} / ${results.length} 个文件不合法`,
    );
  }
  return failed.length === 0 ? 0 : 1;
}

// 只有被直接执行时才跑（被 import 时不产生副作用）。
const invokedDirectly = process.argv[1]?.replaceAll('\\', '/').includes('validate-cli') ?? false;
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}

export { collectFiles, validateFile, main };
