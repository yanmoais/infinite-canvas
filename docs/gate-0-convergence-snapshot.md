# Gate 0 / C0-1 收敛输入快照

> 取证时间：2026-07-18。本文只保存 C0-1 的只读证据，不定义 Gate 状态；状态与排期以 `docs/infinite-canvas-unified-development-plan.md` 为唯一权威。

## 1. 取证边界

本轮只读取 Git、进程、文件哈希和前端存储配置；未运行构建或测试，未向 Gateway/ComfyUI 提交 HTTP 产证请求，未重启进程，也未修改 PoC、Mission_manager 或共享运行时。

## 2. 仓库快照

| 仓库 | Branch / HEAD | 工作区 | 结论 |
|---|---|---|---|
| 主线 `/Users/zhenbao/.codex/local-tools/infinite-canvas` | `main` / `d0b205afc5ae6830e7d42b234dc2f224a4cf85e7` | 163 staged、5 unstaged、722 untracked、0 unmerged | 存在未完成的 v0.9.0 merge，不是 clean baseline |
| PoC `/private/tmp/infinite-canvas-poc-illustrious` | `poc/illustrious-outpaint` / `d0b205afc5ae6830e7d42b234dc2f224a4cf85e7` | 0 staged、16 unstaged、8 untracked、0 unmerged | 与主线 merge-base 同为 `d0b205a`；仅作候选增量源 |
| Mission_manager `/Users/zhenbao/work/Mission_manager` | `main` / `ad56f106ad8325c2c1f832130d269045028ea52f` | 0 staged、9 unstaged、3 untracked、0 unmerged | 共享运行时存在未提交变化 |

主线 merge 元数据：

| 项 | 值 |
|---|---|
| `MERGE_HEAD` | `0e1edd1484f4133aaeca3eb9a0651b2d0cc111cc`（tag `v0.9.0`） |
| `ORIG_HEAD` | `d0b205afc5ae6830e7d42b234dc2f224a4cf85e7` |
| 未解决冲突 | 0 |
| 处置边界 | 已由 BOSS 明确选择继续 merge；完成记录见 §7 |

## 3. 共享运行时快照

### 3.1 8080 进程

| 项 | 值 |
|---|---|
| 监听 | `127.0.0.1:8080` |
| Live PID / PPID | `94507` / `1` |
| 启动时间 | `2026-07-17 23:09:46` |
| 命令 | Python `scripts/local-agent/llama_ui_gateway.py` |
| cwd | `/Users/zhenbao/work/Mission_manager` |
| pidfile | `15648`，与 live PID 不符，视为过期 |

### 3.2 文件指纹

| 对象 | SHA-256 |
|---|---|
| `scripts/local-image/model-registry.json` | `992b82c3102519d136b9842b2e3aef4e8c9e8ecb97045bf44d13f2cd3d3e3aac` |
| `scripts/local-agent/llama_ui_gateway.py` | `fc85810ae36d903af3cca7406c67d30a46172864cbac10ef4f82025f35b6203e` |
| 71 个 workflow JSON 集合 | `c0c4e4295e2a2d98eff5d3363fd7f54ff704050545384ac4d84fa93e0d8667e9` |

Workflow 集合指纹算法：对 `/Users/zhenbao/work/Mission_manager/scripts/local-image/workflows` 下的 71 个 JSON 使用绝对路径按字节序排序；逐文件运行 `shasum -a 256`，清单每行严格为 `<64位小写哈希><两个 ASCII 空格><绝对路径><LF>`，包含最后一行末尾 LF；再对这份 UTF-8/ASCII 清单运行 `shasum -a 256`。该值是清单集合指纹，不是目录原生哈希。

当前已确认的核心共享面改动只有以下 5 个文件；Mission_manager 的其余未提交差异不冒充已冻结：

- `scripts/local-agent/llama_ui_gateway.py`
- `scripts/local-image/model-registry.json`
- `scripts/local-image/workflows/sdxl-reference-faceid-api.json`
- `scripts/local-image/workflows/sdxl-reference-faceid-style-api.json`
- `scripts/local-image/workflows/sdxl-reference-ipadapter-api.json`

## 4. 隔离规则

- 同一 origin 会共享 IndexedDB `infinite-canvas`、`infinite-canvas-plugins`，以及 `infinite-canvas:canvas_store`、`infinite-canvas:ai_config_store` 等持久化 store。
- 主线与 PoC 前端试跑必须使用不同端口或独立浏览器 profile。
- C0-2/C0-3 完成前，共享 8080 不得用于产出下一 Gate 的验收证据。
- 不得为产证重启 8080，或修改 Gateway、Registry、Workflow；共享变化须按 C0-2/C0-3 门禁处理。

## 5. 逐文件合流边界

高风险交叉文件必须以主线为底逐文件语义合并：

```text
web/src/pages/canvas/project.tsx
web/src/services/api/comfy.ts
web/src/lib/canvas/generation-plan.ts
web/src/lib/canvas/generation-runtime-plan.ts
web/src/types/generation.ts
web/src/components/canvas/canvas-node-outpaint-dialog.tsx
```

PoC 候选增量包括：

- `web/src/lib/canvas/illustrious-outpaint-recipe.ts`
- `web/tests/illustrious-outpaint-recipe.test.ts`
- `docs/illustrious-outpaint-poc.md`
- 交叉文件中的 Outpaint operation preflight 与 `modelOverride`/显式空 LoRA 语义

禁止用任一工作树整目录或整文件盲目覆盖另一工作树。

## 6. C0-1 初始出口

首次取证时信息冻结已经完成，但工程推进曾因主线未完成的 v0.9.0 merge 保持 `BLOCKED`。BOSS 随后明确选择继续完成 merge，处置结果见 §7。

## 7. Merge 处置后快照

| 项 | 值 |
|---|---|
| Merge commit | `62738dd2d74da39cee55d5c6118459a6af6574d4`（`Merge tag 'v0.9.0'`） |
| Parents | `d0b205afc5ae6830e7d42b234dc2f224a4cf85e7`、`0e1edd1484f4133aaeca3eb9a0651b2d0cc111cc` |
| `MERGE_HEAD` | 不存在 |
| 工作区 | 0 staged、5 unstaged、723 untracked、0 unmerged |
| 保留边界 | 本会话文档修正和其他 untracked 证据未进入 merge commit；未 push |

C0-1 工程出口现已满足：输入身份、隔离规则、共享运行时和合流边界均可追踪，未完成 merge 阻塞已解除。C0-2 可以按总控开始，但仍不得在共享 8080 上产出下一 Gate 验收证据。
