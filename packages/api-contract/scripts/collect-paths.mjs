/**
 * 收集 `scripts/paths/*.mjs` 的领域片段并合并成一份 OpenAPI 文档。
 *
 * 为什么拆：`gen-openapi.mjs` 原来把 paths 硬编码在文件里，20 张票由多条
 * 泳道并行实现，每条都要加路由 —— 那就是「改一个所有人都改的文件」。
 * 拆分后每条泳道只碰自己那个 `paths/<domain>.mjs`。
 *
 * 约定（故意做得很窄，免得各领域发明自己的写法）：
 *   - 每个 `paths/<domain>.mjs` 导出 `{ paths, components }`，两者都可有可无；
 *   - 文件名以 `_` 开头的不是领域片段（`_shared.mjs` 是公共工具函数）；
 *   - **component 名字全局唯一**。重名直接报错而不是后者覆盖前者：
 *     Orval 生成出来的类型名只由 component 名决定，重名会让前端在无人察觉
 *     的情况下换掉一种形状。
 *   - **path + method 全局唯一**。两条泳道写了同一个路由，说明它们对同一件
 *     事有两种理解，必须人来裁决，不能让字母序决定谁赢。
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** 领域片段的目录：`scripts/paths/`。本文件与 gen-openapi.mjs 都在它外面，不参与收集。 */
export const pathsDir = join(here, 'paths');

/** 按文件名排序收集 —— 顺序稳定，产物才稳定 */
export function listFragmentFiles(dir = pathsDir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.mjs') && !name.startsWith('_'))
    .sort();
}

/**
 * 导入全部领域片段。
 *
 * 用动态 `import()` 而不是读文件字符串：片段里要 `import ... from '../../dist/index.js'`
 * 拿 Zod schema，只有让 Node 真的去解析模块，那条 import 链才会生效。
 */
export async function loadFragments(dir = pathsDir) {
  const files = listFragmentFiles(dir);
  const fragments = [];
  for (const name of files) {
    const url = pathToFileURL(join(dir, name)).href;
    const mod = await import(url);
    fragments.push({
      file: name,
      domain: name.replace(/\.mjs$/, ''),
      paths: mod.paths ?? {},
      components: mod.components ?? {},
    });
  }
  return fragments;
}

/**
 * 合并片段，冲突即报错。
 *
 * 返回的 `sources` 记录每个 path/component 来自哪个文件 —— 冲突时错误信息
 * 要能直接指到人（「改哪个文件」），而不是只说「有重复」。
 */
export function mergeFragments(fragments) {
  const paths = {};
  const pathSource = new Map();
  const components = {};
  const componentSource = new Map();
  const errors = [];

  for (const fragment of fragments) {
    for (const [pathKey, pathItem] of Object.entries(fragment.paths)) {
      for (const method of Object.keys(pathItem)) {
        const id = `${method.toUpperCase()} ${pathKey}`;
        if (pathSource.has(id)) {
          errors.push(`${id} 重复定义：${pathSource.get(id)} 与 ${fragment.file}`);
          continue;
        }
        pathSource.set(id, fragment.file);
      }
      if (paths[pathKey]) {
        // 同一 path 的不同 method 是合法的（GET + POST），合并而不是报错
        paths[pathKey] = { ...paths[pathKey], ...pathItem };
      } else {
        paths[pathKey] = pathItem;
      }
    }

    for (const [name, schema] of Object.entries(fragment.components)) {
      if (componentSource.has(name)) {
        errors.push(
          `component "${name}" 重复定义：${componentSource.get(name)} 与 ${fragment.file}。` +
            '重名会静默替换前端生成出来的类型形状，请改名。',
        );
        continue;
      }
      componentSource.set(name, fragment.file);
      components[name] = schema;
    }
  }

  if (errors.length > 0) {
    throw new Error(`契约片段合并失败：\n  - ${errors.join('\n  - ')}`);
  }

  return {
    paths,
    components,
    /** path/component → 来源文件，供调试与冲突诊断 */
    sources: { paths: pathSource, components: componentSource },
  };
}
