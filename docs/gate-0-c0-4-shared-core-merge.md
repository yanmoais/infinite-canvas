# Gate 0 / C0-4 Shared Core 合流证据

来源基线：主线工作区（本仓库）为底，候选源 `/private/tmp/infinite-canvas-poc-illustrious`（`poc/illustrious-outpaint` 分支）逐文件语义合并，无整文件覆盖。

## 合入点

1. **`web/src/types/generation.ts`**
   - `OperationProfile` 增加 `modelOverride?: string`。
   - `RegisteredModelCapability.runtime` 增加 `optionalMissingNodeTypes?` / `optionalMissingRuntimeAssets?` / `optionalInputCompatibilityIssues?`。
   - 保留主线 receipt v2 全部类型，未降级。

2. **`web/src/lib/canvas/generation-plan.ts`**
   - `modelOverride` 优先模型；跨模型 `loras=[]`；`source=operation_profile`；protections 文案。

3. **`web/src/lib/canvas/generation-runtime-plan.ts`**
   - 首个参考映射真实 source node provenance。
   - `ipadapter_template` 优先绑定。
   - binding 健康门槛：文件/探针/节点、`inputCompatibility` 显式非 compatible 拒绝、required assets 与 missing/optionalMissing 经 normalize 后匹配则拒绝；不写不可执行 `workflowBindingId`/hash。

4. **`web/src/services/api/comfy.ts`**
   - `normalizeAssetId` / `normalizeMissingRuntimeAssetId`：尾部诊断后缀识别 `not visible`、`ComfyUI 未扫到`、`Loader 无枚举`；版本括号不误删。
   - `workflowBindingFailureReasons` + `preflightComfyOutpaint`。
   - 主线 `enabled:false` LoRA profile 过滤保留。

5. **测试**
   - generation-plan：modelOverride 空 LoRA（只写未定向跑）。
   - generation-runtime-plan / comfy-capabilities：已定向 `tsx --test` 通过；覆盖 provenance、ipadapter、input incompatible、中英文诊断缺失资产、版本括号不误合并。
   - 未跑全量 `npm test` / typecheck / build。

## 复审修复

- **P0**：原先只剥英文 `(not visible)`，无法匹配 Gateway ` (ComfyUI 未扫到)` / ` (Loader 无枚举)`，已修。
- **P1**：`buildComfyExecutionPlan` 不再记录不可执行 IPAdapter binding；fixture 补齐类型字段；文档状态冲突已收敛。

## 未合入边界

- C0-5 UI 调用链已另案合入，见 `docs/gate-0-c0-5-ui-callchain-merge.md`。
- C0-6 U1-R0 合同/schema 已另案合入，见 `docs/gate-0-c0-6-tests-and-docs.md`；真实实验 manifest 仍未冻结。
- Illustrious Fooocus recipe 未引入产品路径。
- 未 commit/push；未改 Mission_manager / Windows ComfyUI。

## 状态

C0-4 = `DONE`（含 P0/P1 修复）；C0-5 = `DONE`；C0-6 = `DONE`；C0-Z = `DONE`；Gate 0 = `DONE`；Gate A = `IN_PROGRESS`（U1-R0-P 已冻结）。
