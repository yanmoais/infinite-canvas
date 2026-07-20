# Gate 0 / C0-5 UI 调用链合流证据

来源基线：主线工作区为底，候选源 `/private/tmp/infinite-canvas-poc-illustrious`（`poc/illustrious-outpaint`）仅合入 Outpaint UI 调用链语义，不整文件覆盖。

## 合入点

1. **`web/src/components/canvas/canvas-node-outpaint-dialog.tsx`**
   - 新增 `config: AiConfig` 与 payload 字段 `model`。
   - 面板「续接模型 / 画风」使用既有 `ModelPicker`（`capability="image"`）。
   - 默认模型：`config.imageModel` 为 Comfy 时优先，否则回落源图 recipe / 配置模型。
   - 提交中：`submitting` 防重入，关闭键与 mask 在提交时锁定。
   - 侧栏增强组件文案：跨模型显示「跨模型续接 · 不继承源 LoRA」。

2. **`web/src/pages/canvas/project.tsx`**
   - `outpaintSourceLocksRef`：同一源图同时只允许一个扩图任务。
   - 以 `payload.model` 作为续接模型；要求 `isComfyModel`，不再强制源图本身已是 Comfy 配方。
   - 关闭对话框前执行 `preflightComfyOutpaint`：`unavailable` 阻断并保留对话框，`degraded` 警告后继续。
   - 同模型：`inheritSourceRecipe=true`，不写 `modelOverride`。
   - 跨模型：写 `modelOverride`，`inheritSourceRecipe=false`，由 C0-4 `buildManagedImageExecution` 显式清空 LoRA。
   - 提示词仍走主线 `resolveOutpaintPromptWithUserCustomization` / 默认词路径，不接通用优化器。
   - 提示词确定后 `buildComfyExecutionPlan(... operation: "outpaint", decision: outpaintPreflight ...)`，再写回 `sharedExecutionPlan`。

## 保留边界

- 主线 PromptCompiler / smart compose / stale 一跳传播未改。
- 未引入 Illustrious Fooocus recipe；U1-R0 合同由 C0-6 另案落盘。
- 未改 Mission_manager / Windows ComfyUI。
- 按项目规则未执行构建 / 全量 test / typecheck。

## 状态

C0-5 = `DONE`；C0-6 = `DONE`；C0-Z = `DONE`；Gate 0 = `DONE`；Gate A 仍 `BLOCKED`（待真实 U1-R0 manifest）。
