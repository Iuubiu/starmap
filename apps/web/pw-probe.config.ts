import base from './playwright.config';

/**
 * 临时探针配置：把 expect 默认超时从 5s 放宽到 20s，用来区分
 * 「元素真的不存在」和「元素存在但没在 5 秒内渲染出来」。用完即删。
 */
export default {
  ...base,
  expect: { timeout: 20_000 },
};
