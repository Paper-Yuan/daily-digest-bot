/**
 * 控制台渠道:永远可用,本地调试与 CI 日志排查的主要出口。
 */

export async function sendConsole(msg: { text: string }): Promise<void> {
  const line = '='.repeat(46);
  console.log(`\n${line}\n报告内容(控制台渠道)\n${line}`);
  console.log(msg.text);
  console.log(`${line}\n`);
}
