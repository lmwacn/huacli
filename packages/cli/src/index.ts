#!/usr/bin/env node
import { HuaCliApp } from "@hua/core";
import { sqlPlugin } from "@hua/plugin-sql";
import { httpPlugin } from "@hua/plugin-http";
import { sshPlugin } from "@hua/plugin-ssh";
import { weixinPlugin } from "@hua/plugin-weixin";

async function main(): Promise<void> {
  const app = new HuaCliApp();
  app.registerPlugin(sqlPlugin);
  app.registerPlugin(httpPlugin);
  app.registerPlugin(sshPlugin);
  app.registerPlugin(weixinPlugin);
  await app.run(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
