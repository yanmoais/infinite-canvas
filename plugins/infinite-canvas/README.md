# Infinite Canvas Codex Plugin

这个插件把 Infinite Canvas 的本地 Canvas Agent MCP 打包给 Codex app 使用，让 Codex 能打开本地画布、读取当前节点、创建内容并触发生成流程。

## 安装

### AI 自动安装

把下面这段发给 Codex：

```text
请从 https://github.com/basketikun/infinite-canvas.git 安装 Infinite Canvas Codex 插件。
请 clone 仓库到 ~/plugins/infinite-canvas，确认 plugins/infinite-canvas/.codex-plugin/plugin.json 存在，
把 plugins/infinite-canvas 加入 personal marketplace，先运行 codex plugin marketplace add ~，
再运行 codex plugin add infinite-canvas@personal。
安装后请校验插件，并告诉我是否需要开启一个新对话来加载新技能和 MCP 工具。
```

### 手动安装

推荐把仓库 clone 到 Codex personal marketplace 默认会引用的位置：

```bash
mkdir -p ~/plugins
git clone https://github.com/basketikun/infinite-canvas.git ~/plugins/infinite-canvas
```

确保 `~/.agents/plugins/marketplace.json` 中有 Infinite Canvas 条目，注意 `path` 指向仓库里的插件子目录：

```json
{
  "name": "personal",
  "interface": {
    "displayName": "Personal"
  },
  "plugins": [
    {
      "name": "infinite-canvas",
      "source": {
        "source": "local",
        "path": "./plugins/infinite-canvas/plugins/infinite-canvas"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

然后注册 personal marketplace 并安装插件：

```bash
codex plugin marketplace add ~
codex plugin add infinite-canvas@personal
```

安装后建议开启一个新的 Codex 对话，让新的 skill 和 MCP 工具完整加载。

### 本仓库开发调试

如果你就在 Infinite Canvas 仓库中调试插件，可以直接添加仓库自带 marketplace。建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/infinite-canvas
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

常用提示：

```text
打开 Infinite Canvas
读取当前画布并总结节点结构
根据选中节点创建一组生图提示词
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
