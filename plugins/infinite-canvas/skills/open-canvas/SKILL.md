---
name: open-canvas
description: 打开 Infinite Canvas 在线或本地画布，并自动连接本地 Canvas Agent。用户要求打开、启动、进入或使用 Infinite Canvas 画布时使用。
---

# Open Infinite Canvas

默认打开在线版。只有用户明确要求使用本地项目时，才启动本地前端。

## 在线版

1. 启动本地 Canvas Agent 并保持运行：

```bash
npx -y @basketikun/canvas-agent
```

2. 从启动输出取得 `Local URL` 和 `Connect token`。

1. 如果当前仓库是 Infinite Canvas 项目，优先使用当前仓库的 `web/` 前端（**Vite**，不是 Next.js）。
2. 先检查本地端口归属：如果 `3000`、`3001` 等端口已被占用，必须用 `lsof`/`ps` 或服务输出确认监听进程的工作目录属于当前仓库的 `web/`，不能只因为端口存在就当成本地画布。
3. 如果已有当前仓库的 Vite dev 服务，复用它并记录真实画布地址，例如 `http://localhost:3000` 或 `http://localhost:3001`。
4. 如果没有当前仓库的服务，启动本地画布开发服务，默认在 `web/` 下运行：

```bash
cd web
bun install   # 或 npm install
bun run dev   # 等价于 vite --host 0.0.0.0 --port 3000
```

若默认端口被其他项目占用，改用空闲端口启动，例如：

```bash
cd web
bunx vite --host 0.0.0.0 --port <空闲端口>
```

不要执行构建或测试。

5. 启动本地 Canvas Agent（HTTP 桥，默认 `http://127.0.0.1:17371`）：

```bash
npx -y @basketikun/canvas-agent
```

如果 Agent 已经在运行，则读取 `~/.infinite-canvas/canvas-agent.json` 获取 `url` 和 `token`；也可用本机无 Origin 的方式请求 `http://127.0.0.1:17371/config`（CLI 会返回 token，浏览器跨 Origin 仅在 Origin 已首绑时返回 token）。

6. 读取 Agent 输出或配置中的 `Local URL` 和 `Connect token`，不要让用户手动复制。
7. 不走本地 Agent 的 `/open` 跳转；直接构造并打开最终 URL：`<真实画布地址>/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>`。
8. 画布网页会自动新建具体画布、打开本机 Agent 面板并连接本地 Agent；不要用浏览器点击新建画布。
9. 打开后再使用 `canvas_get_state` 检查画布是否已经连接；如果尚未连接，等待片刻再检查，不要改用线上站点，除非用户明确要求。
3. 在 Codex 右侧浏览器打开：

```text
https://canvas.best/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>
```

- 如果当前工作区不是 Infinite Canvas 源码仓库，优先提示用户先打开或启动 Infinite Canvas 网页，再连接本地 Agent。
- 可以使用线上画布地址或用户给出的本地地址作为 `<画布网页地址>`，但仍要通过本地 Canvas Agent 获取 token 后再打开最终 URL。
- 不要假设用户已经安装本仓库依赖；插件的 MCP 会通过 `npx -y @basketikun/canvas-agent mcp` 使用已发布的 Canvas Agent。MCP 进程在探测到 HTTP Agent 未运行时会尝试自动拉起；若仍失败，请手动运行不带 `mcp` 的 `npx -y @basketikun/canvas-agent`。
## 本地版

1. 在 Infinite Canvas 项目中启动前端，并使用 Vite 输出的 `Local` 地址：

```bash
cd web
bun install
bun run dev
```

2. 启动本地 Canvas Agent：

```bash
npx -y @basketikun/canvas-agent
```

3. 从启动输出取得 `Local URL` 和 `Connect token`，在 Codex 右侧浏览器打开：

```text
<Vite Local 地址>/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>
```

## MCP 与连接地址

插件在新的 Codex 任务中加载时会自动启动 `npx -y @basketikun/canvas-agent mcp`。这个 MCP 进程负责提供画布工具，不提供网页连接服务；
上面启动的普通 Canvas Agent 负责提供 `Local URL` 和 `Connect token`。两个进程读取同一份本地配置，因此不需要用户手动填写地址或 token。

## 打开模式

用户没有明确指定打开方式时，始终使用 `mode=new` 新建画布。只有用户明确要求时才替换为：

- 最近画布：`mode=recent`
- 自己选择：`mode=choose`
