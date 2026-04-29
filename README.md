# hua-cli

一个基于 Node.js + TypeScript 的插件化 CLI 工具骨架。

当前内置了 `sql` 插件的最小实现，用来演示插件注册、命令分发和后续数据库能力接入的结构。

## 特性

- 基于 `commander` 的命令行解析
- 使用 workspace 组织 `cli`、`core`、`plugin-sdk`、`plugin-sql`
- 通过插件接口注册命令
- 支持通过 `npm link` 在本机全局使用 `hua`

## 项目结构

```text
hua-cli/
  packages/
    cli/          # CLI 入口
    core/         # 命令注册与运行时
    plugin-sdk/   # 插件接口定义
    plugin-sql/   # sql 插件示例
```

## 环境要求

- Node.js 18+
- npm 9+

## 安装依赖

```bash
npm install
```

## 构建

```bash
npm run build
```

## 本地运行

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js sql --help
node packages/cli/dist/index.js sql query "select 1" --profile dev
```

也可以使用根脚本：

```bash
npm run hua -- --help
npm run hua -- sql --help
```

## 全局使用

在项目根目录执行：

```bash
npm install
npm run build
npm link
```

完成后即可在任意目录直接使用：

```bash
hua --help
hua sql --help
hua sql profile-list
hua sql query "select 1" --profile dev
```

取消全局链接：

```bash
npm unlink -g hua-cli
```

如果只是移除当前项目和全局命令的关联，也可以重新进入项目目录后执行：

```bash
npm unlink
```

## 当前命令

```bash
hua --help
hua sql --help
hua sql profile-list
hua sql query "select 1" --profile dev
```

说明：

- `sql profile-list` 当前返回占位信息
- `sql query` 当前只打印参数，尚未连接真实 MySQL

## 插件开发

插件开发规范见 [docs/plugin-development.md](./docs/plugin-development.md)。

最小插件示例：

```ts
import { definePlugin } from "@hua/plugin-sdk";

export const helloPlugin = definePlugin({
  name: "hello",
  description: "example plugin",
  commands: [
    {
      name: "say <name>",
      description: "say hello",
      async action(context) {
        context.log(`hello, ${context.args[0]}`);
      },
    },
  ],
});
```

## 开发建议

- 将参数解析放在 `commands`
- 将业务逻辑放在 `services`
- 将第三方能力封装放在 `drivers`
- 保持 `core` 不直接依赖具体业务插件

## 下一步计划

- 增加配置文件读写
- 增加 `sql profile add/list/use`
- 接入 `mysql2`
- 支持真实 SQL 查询结果输出
