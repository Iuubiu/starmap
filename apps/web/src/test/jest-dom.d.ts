/**
 * jest-dom 匹配器（`toBeInTheDocument` 等）的类型扩展。
 *
 * 为什么手写而不用 `@testing-library/jest-dom/vitest`：
 * jest-dom 6.9.1 的声明还是 vitest 3 时代的
 *
 *     declare module 'vitest' { interface Assertion<T = any> { ... } }
 *
 * 而 vitest 5 的签名是 `Assertion<R extends void | Promise<void> = void, T = unknown>`
 * —— **第一个类型参数是返回类型，不是值类型**。两个声明的类型参数列表不一致时，
 * TypeScript 的接口合并会静默失败，且 `skipLibCheck: true` 会把本该报出的
 * "All declarations of 'Assertion' must have identical type parameters" 吞掉。
 * 结果就是测试全绿但类型检查报 `Property 'toBeInTheDocument' does not exist`。
 *
 * 这里用 vitest 5 的正确签名重新声明，并把值类型放到**第二个**参数上。
 *
 * 注意导入路径是 `@testing-library/jest-dom/matchers`（exports 映射到
 * `types/matchers-standalone.d.ts`），**不是** `.../types/matchers` ——
 * 后者不在 jest-dom 的 exports 映射里，`moduleResolution: bundler` 下会报
 * TS2307 找不到模块。
 */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void, T = unknown>
    extends TestingLibraryMatchers<unknown, T> {
    /** 值类型在第 2 个参数上，泛型约束与 vitest 5 保持一致。 */
    _?: [R, T];
  }
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
