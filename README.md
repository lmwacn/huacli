# hua-cli

一个基于 Node.js + TypeScript 的插件化 CLI 工具骨架。

内置了 `sql`、`http`、`ssh` 三个插件，分别用于数据库查询、HTTP 请求测试和远程服务器管理。

## 特性

- 基于 `commander` 的命令行解析
- 使用 workspace 组织多个包
- 通过插件接口注册命令
- 支持通过 `npm link` 在本机全局使用 `hua`

## 项目结构

```text
hua-cli/
  packages/
    cli/          # CLI 入口
    core/         # 命令注册与运行时
    plugin-sdk/   # 插件接口定义
    plugin-sql/   # MySQL 数据库查询
    plugin-http/  # HTTP 请求测试
    plugin-ssh/   # SSH 远程服务器管理
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
hua sql profile list
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

### SQL 插件

```bash
hua sql profile add dev --host 127.0.0.1 --port 3306 --user root --database test
hua sql profile list
hua sql profile use dev
hua sql profile show
hua sql profile remove dev
hua sql query "SELECT * FROM users LIMIT 10" --profile dev
```

### HTTP 插件

```bash
hua http profile add dev --base-url http://localhost:3000
hua http profile list
hua http get /api/users --profile dev
hua http post /api/users --data '{"name":"test"}' -H "Content-Type: application/json"
```

### SSH 插件

```bash
hua ssh profile add prod --host 1.2.3.4 --username root --password xxx
hua ssh profile list
hua ssh exec -p prod "uname -a && df -h"
hua ssh upload ./file.txt /remote/path/file.txt
hua ssh download /remote/path/file.txt ./local-file.txt
```

所有配置统一存储在 `~/.hua/config.json`。

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

- SSH 插件：增加 `shell`（交互式 shell）、`upload`/`download`（文件传输）、`tunnel`（端口转发）命令
- HTTP 插件：增加响应格式化、历史记录等功能
- SQL 插件：支持更多输出格式（json/csv）、执行脚本文件
- 通用：项目级配置覆盖、环境变量支持
