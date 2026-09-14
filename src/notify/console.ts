/**
 * 控制台渠道:永远可用,本地调试与 CI 日志排查的主要出口。
 * 传入图片时额外存一份到本地临时目录,便于肉眼检查渲染效果。
 */

import * as fs from 'fs';
import * as path from 'path';

export async function sendConsole(
  msg: { text: string },
  image?: Buffer | null,
): Promise<void> {
  const line = '='.repeat(46);
  console.log(`\n${line}\n报告内容(控制台渠道)\n${line}`);
  console.log(msg.text);
  console.log(`${line}`);
  if (image && image.length > 0) {
    try {
      const dir = path.resolve('data/out');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `report-${Date.now()}.png`);
      fs.writeFileSync(file, image);
      console.log(`🖼 图片已生成:${file}(${(image.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.log(`🖼 图片已生成(${(image.length / 1024).toFixed(1)} KB),但写入本地失败:${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log('\n');
}
