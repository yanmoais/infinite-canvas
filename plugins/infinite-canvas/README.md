# Infinite Canvas Codex Plugin

让 Codex 可以打开并操作 Infinite Canvas。

## 安装

macOS / Linux：

```bash
git clone https://github.com/basketikun/infinite-canvas.git
cd infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

开发 MCP 时建议指向本仓库构建产物，避免 `npx` 拉到旧 npm 包：

```bash
cd canvas-agent && npm run build
codex mcp add infinite-canvas -- node "$(pwd)/dist/index.js" mcp
```

## 使用

1. 新建 Codex 线程后说“打开 Infinite Canvas”。
2. 插件会确认当前仓库的本地画布服务是否已运行；端口被占用时会检查进程归属，不会把其他项目的 `3000` 当作 Infinite Canvas。
3. 确认或启动后，插件会直接打开新建画布 URL，并自动尝试连接本地 Agent。
4. 画布打开后，让 Codex 读取或操作当前画布。顶栏图标为绿色「画布已连接」时工具桥才就绪。
Windows PowerShell：
```powershell
git clone https://github.com/basketikun/infinite-canvas.git
cd infinite-canvas
codex plugin marketplace add "$PWD"
codex plugin add infinite-canvas@infinite-canvas-local

Windows CMD 将 `$PWD` 替换为 `%cd%`。

安装后新建一个 Codex 任务，然后输入：

```text
帮我打开并连接到 Infinite Canvas
```

## 工作机制

插件默认通过以下命令启动 MCP：

```bash
npx -y @basketikun/canvas-agent mcp
```

MCP 进程会探测本机 HTTP Agent；若未运行会尝试自动拉起后台 HTTP Agent，再以 stdio 暴露工具。工具调用仍依赖浏览器画布已打开并完成工具桥连接。

## 手动排查

优先本地启动画布（Vite）：

```bash
cd web
bun install
bun run dev
```

然后启动本地 HTTP Agent：

```bash
npx -y @basketikun/canvas-agent
```

从 Agent 启动输出或 `~/.infinite-canvas/canvas-agent.json` 读取 Local URL 和 Connect token。本机 CLI 也可访问 `http://127.0.0.1:17371/config`（无 Origin 时会返回 token）。然后打开：

```text
<画布网页地址>/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>
```

不要通过页面点击来新建画布；`mode=new` 会让网页自动创建具体画布并连接本地 Agent。
