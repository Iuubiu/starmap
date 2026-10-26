/**
 * 唯一的输入条（Composer）。
 *
 * ## 为什么要有这个文件
 *
 * 票 83 之前，学习页与学习记录页各写了一条「textarea + 提交按钮」：
 * 样式各写一份、`aria-label` 各写一份、Enter 的边界（Enter 提交 /
 * Shift+Enter 换行）也各写一份。两处一旦漂移，同一句话在两个页面里的
 * 行为就不一样 —— 而学生根本不知道自己在哪一页。
 *
 * 所以这里收成**一个实现**：`pages/HomePage.tsx` 与 `pages/LearningPage.tsx`
 * 都只引用它。谁要是再写第二条输入条，全仓就出现了两个输入条实现，
 * 行为漂移的问题原样回来。
 *
 * ## 形状：B5 的一整块（票 01 定版，spec §0）
 *
 * 输入区是一整块：`textarea` 本身无边框、铺满宽度，圆角来自
 * `.sm-composer-box`（玻璃填充）；框内底行是「关于这一轮怎么发」的控件
 * （＋ / 模型 ▾ / 麦克风 / 圆形发送）。曾经的另外两层已按 B5 移除：
 *
 * - **框下工具条**（期刊下载器/文件/插件/视图切换）：预览两版都没有，
 *   且当时无真实行为（spec §3），连 `:focus-within` 的显隐 CSS 一起删了。
 * - **框内档位 chip**：档位是测量结果，不该出现在输入条上（用户裁定），
 *   展示归右栏档位卡（票 02/T2）。
 *
 * `context` 插槽暂为 v2 首页（HomeV2 的知识点条）保留；v1 两页已不再传，
 * 知识点名字的展示由右栏「正在学」卡接回（票 03/T3）。
 *
 * ## 为什么不用 Fluent 的 Textarea
 *
 * Fluent 的 `Textarea` 自带一层 `fui-Textarea` 包裹元素与边框样式，
 * 与「无边框大圆角」冲突时要靠 `!important` 或额外的 `::after` 重置，
 * 反而更难维护。这里用原生 `textarea`，把「有哪些按钮」交给 Fluent 的
 * `Button`，把「长什么样」交给 `theme/glass.css` 的 `.sm-composer-*`。
 */
import { Button } from '@fluentui/react-components';
import {
  Add24Regular,
  ChevronDown16Regular,
  Mic24Regular,
  Send24Filled,
} from '@fluentui/react-icons';
import { useId, type KeyboardEvent, type ReactNode } from 'react';

export interface ComposerProps {
  /** 受控文本 */
  value: string;
  onChange: (value: string) => void;
  /** 提交这一轮。Enter 与圆形发送都调它 */
  onSubmit: () => void;
  placeholder?: string;
  /** 输入框的可访问名。默认沿用票 10 的「这一轮想说的话」，既有测试不必改 */
  ariaLabel?: string;
  /** 提交中：输入框与按钮都禁用，避免同一句话发两轮 */
  busy?: boolean;
  /** 契约上限（`utterance` 2000 字）。不传则不限制 */
  maxLength?: number;
  /**
   * 已废弃（票 01 按 B5 移除档位 chip）：传了也不渲染。
   * 字段暂留是为了 v2 首页的既有传参能过 typecheck，v2 收口时一并删除。
   */
  tierLabel?: string;
  /** 模型选择器的文字 */
  modelLabel?: string;
  /** 输入框上方的上下文（v2 首页的知识点条）。不传则整行不渲染 */
  context?: ReactNode;
  /** 输入框下方的提示（字数、错误条）。不传则不渲染 */
  hint?: ReactNode;
  /** 页面级的额外类名（首页用来把输入条吸在底部） */
  className?: string;
  autoFocus?: boolean;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder = '说说你想学什么，或者你卡在哪一步。',
  ariaLabel = '这一轮想说的话',
  busy = false,
  maxLength,
  modelLabel = '默认模型',
  context,
  hint,
  className,
  autoFocus = false,
}: ComposerProps) {
  const hintId = useId();

  /**
   * Enter 提交、Shift+Enter 换行。
   *
   * 这里必须拦 `isComposing`：中文输入法选词时按 Enter 是「确认候选」，
   * 不拦的话学生选一个字就把整句发出去了 —— 这是中文界面上最常见的
   * 误发来源，而英文用户永远遇不到。
   */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!busy && value.trim() !== '') onSubmit();
  }

  return (
    <div className={className ? `sm-composer ${className}` : 'sm-composer'}>
      <div className="sm-composer-box">
        {/* 上下文条属于输入框内部的一行：下方用横线与输入区隔开，不另起一栏 */}
        {context ? <div className="sm-composer-context">{context}</div> : null}
        <textarea
          className="sm-composer-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-describedby={hint ? hintId : undefined}
          rows={2}
          maxLength={maxLength}
          disabled={busy}
          autoFocus={autoFocus}
        />

        <div className="sm-composer-row">
          <Button
            appearance="subtle"
            shape="circular"
            size="small"
            icon={<Add24Regular />}
            aria-label="添加内容"
          />
          <Button
            appearance="subtle"
            size="small"
            icon={<ChevronDown16Regular />}
            iconPosition="after"
            aria-label={`选择模型（当前 ${modelLabel}）`}
          >
            {modelLabel}
          </Button>
          <span className="sm-composer-grow" />
          <Button
            appearance="subtle"
            shape="circular"
            size="small"
            icon={<Mic24Regular />}
            aria-label="语音输入"
          />
          <button
            type="button"
            className="sm-composer-send"
            aria-label={busy ? '正在发送' : '提交这一轮'}
            disabled={busy || value.trim() === ''}
            onClick={() => onSubmit()}
          >
            <Send24Filled />
          </button>
        </div>
      </div>

      {hint ? (
        <div className="sm-composer-hint" id={hintId}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
