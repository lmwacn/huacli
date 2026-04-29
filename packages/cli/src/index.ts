#!/usr/bin/env node
import { HuaCliApp } from "@hua/core";
import { sqlPlugin } from "@hua/plugin-sql";

async function main(): Promise<void> {
  const app = new HuaCliApp();
  app.registerPlugin(sqlPlugin);
  await app.run(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
