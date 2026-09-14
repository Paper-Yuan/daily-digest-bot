import { defineConfig } from 'vitest/config';

/**
 * 默认 5s 超时对重试类用例偏紧:github 的失败降级用例走真实计时器做指数退避,
 * 单个约 2s,和图片渲染(可能触发字体下载)并发时在冷启动机器上会顶到上限,
 * 表现为偶发的 timeout 失败。这里统一放宽,避免把机器抖动误报成回归。
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
