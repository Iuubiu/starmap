/**
 * 极简富文本渲染 —— 只覆盖关卡作者实际会用到的四种行内记号。
 *
 * 为什么不上 Markdown 库：现在的内容格式只有 `**粗体**`、`` `代码` ``、
 * `$公式$` 和空行分段，引一个完整的 Markdown 解析器（连同它的 HTML 消毒
 * 配置）是为了 4 个正则引入 200KB 依赖和一条 XSS 面。真要支持标题/列表/
 * 引用时再换，届时是个明确的决定，而不是「顺手加个库」。
 *
 * **不做 HTML 透传**：正文一律当纯文本切分后交给 React 渲染，作者写
 * `<script>` 就只会看到这几个字符。内容来自教师与 AI，不信任它。
 *
 * 公式：没有 KaTeX 也不打算有（它需要字体文件与 CSS，还要处理 CJK 排版）。
 * 内容里实际出现的命令只有 `\\overline` `\\cap` `\\cup` `\\oplus`
 * `\\Rightarrow` 与几个间距命令，把它们翻译成 Unicode 之后是可读的；
 * 翻译不了的命令**原样保留**——显示成 `\\frac` 比悄悄吃掉更像「这里有问题」。
 */
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  /** 公式用等宽衬线 + 浅底，与正文拉开层次，避免和中文正文混在一起读不出来。 */
  math: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
    background: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    padding: '0 4px',
    whiteSpace: 'nowrap',
  },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
    background: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    padding: '0 4px',
  },
  bold: { fontWeight: tokens.fontWeightSemibold },
  paragraph: {
    display: 'block',
    marginBottom: '10px',
    lineHeight: tokens.lineHeightBase400,
  },
});

/** LaTeX 命令 → Unicode。只收内容里出现的，多收没用。 */
const SYMBOLS: Record<string, string> = {
  '\\Rightarrow': '⇒',
  '\\rightarrow': '→',
  '\\Leftarrow': '⇐',
  '\\leftrightarrow': '↔',
  '\\cap': '∩',
  '\\cup': '∪',
  '\\oplus': '⊕',
  '\\cdot': '·',
  '\\times': '×',
  '\\neq': '≠',
  '\\leq': '≤',
  '\\geq': '≥',
  '\\quad': '\u2003',
  '\\;': '\u2002',
  '\\,': '\u2009',
  '\\ ': ' ',
};

/** 覆盖线上那些不能加下划线的字符（`∩`、`·` 上加横线是乱码）。 */
const OVERLINABLE = /[A-Za-z0-9]/;

/**
 * 把 `\overline{X}` 换成「每个字母/数字后面跟一个组合长音符」。
 *
 * `\overline{A·B}` → `A̅·B̅`，读起来就是「A 与 B 整体取反」。逐个字母加而不是
 * 加在整串后面，是因为组合符只作用于紧邻的前一个字符——加在整串尾部只会
 * 压到最后一个字母上，反而把公式读错。
 */
function foldOverline(source: string): string {
  let text = source;
  for (let guard = 0; guard < 20; guard += 1) {
    const start = text.indexOf('\\overline{');
    if (start < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = start + '\\overline'.length; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break; // 括号没闭合：原样留着，让作者看见
    const inner = foldOverline(text.slice(start + '\\overline{'.length, end));
    const barred = [...inner]
      .map((char) => (OVERLINABLE.test(char) ? `${char}\u0304` : char))
      .join('');
    text = text.slice(0, start) + barred + text.slice(end + 1);
  }
  return text;
}

/** 公式源码 → 可读文本。纯函数，导出成便于单测。 */
export function renderMath(source: string): string {
  let text = foldOverline(source);
  for (const [command, symbol] of Object.entries(SYMBOLS)) {
    text = text.split(command).join(symbol);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 题干/选项里用：把 `$…$` 去掉、命令翻成 Unicode，得到一行纯文本。
 *
 * 为什么选项不走富文本：Fluent 的 `Radio` 只接受 `label` 插槽，塞进组件
 * 会让读屏器把选项念成两个不连续片段。选项本来就短，转纯文本更稳。
 */
export function plainText(source: string): string {
  return source
    .replace(/\$([^$]+)\$/g, (_, math: string) => renderMath(math))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\$[^$]+\$)/g;

/** 渲染一行里的行内记号。 */
export function InlineRich({ text }: { text: string }): ReactNode {
  const styles = useStyles();
  const parts = text.split(INLINE).filter((part) => part !== '');
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <strong key={index} className={styles.bold}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code key={index} className={styles.code}>
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
          /**
           * 公式**不加** `key` 之外的处理，也不做字符串拼接的那套缓存：
           * 一段讲解里公式不超过十来个，重渲染的代价远小于缓存失效。
           */
          return (
            <span key={index} className={styles.math} translate="no">
              {renderMath(part.slice(1, -1))}
            </span>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

/**
 * 正文渲染：空行分段，段内单换行保留为换行。
 *
 * 为什么保留单换行：作者写推导时常用「一行一步」，把它们合并成一句会让
 * 推导过程糊成一段，那正是这张卡要讲清楚的东西。
 */
export function RichText({ body }: { body: string }): ReactNode {
  const styles = useStyles();
  const paragraphs = body.split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((paragraph, paragraphIndex) => (
        <span key={paragraphIndex} className={styles.paragraph}>
          {paragraph.split('\n').map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 && <br />}
              <InlineRich text={line} />
            </Fragment>
          ))}
        </span>
      ))}
    </>
  );
}
