import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';
import './theme/tokens.css';
import './theme/motion.css';
import './theme/glass.css';

/**
 * 应用入口。
 *
 * ## 为什么 `FluentProvider` 不在这里了
 *
 * 以前这里与 `App.tsx` 各写了一遍 `<FluentProvider theme={webLightTheme}>`。
 * 主题可切换后，两处各持一个 theme 对象必然打架（内层覆盖外层），所以
 * provider 收进 `ThemeProvider`，只留一处。
 *
 * ## 为什么先 import tokens.css 再 import motion.css 再 import glass.css
 *
 * 顺序有意义：`motion.css` 里的 `::view-transition-*` 规则要读到
 * `--sm-dur-scene` 等变量，`glass.css` 里的玻璃原语要读到 `--sm-bg-canvas`
 * 与 `--sm-accent`，而这些变量都在 `tokens.css` 里声明。CSS 变量是运行期
 * 解析的，理论上顺序无关；但打包器会按 import 顺序拼接，把依赖方放后面能让
 * 产物读起来是「先定义、后使用」。
 *
 * ## 首帧不闪
 *
 * 主题色在 `index.html` 的内联脚本里已经写到 `<html data-sm-theme>`，
 * 本文件不参与「第一帧是什么颜色」的决策 —— 见 `theme/tokens.css` 顶部注释。
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
