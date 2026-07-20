# Gate 0 / C0-Z 独立验收证据

## 范围

对 C0-1 → C0-6 合流结果执行约定测试、diff check 与多轮独立 review；关闭全部 Blocking/P0/P1 后将 Gate 0 置为 `DONE`。  
**不**生成真实 U1-R0 `manifest.json`，**不**提交 18 cells，**不**启动 Gate A 实验。

## 约定测试

命令：

```bash
cd web && npx tsx --test \
  tests/u1-r0-contract.test.ts \
  tests/generation-contract.test.ts \
  tests/generation-plan.test.ts \
  tests/generation-runtime-plan.test.ts \
  tests/generation-dependencies.test.ts \
  tests/image-execution-receipt.test.ts \
  tests/comfy-capabilities.test.ts
```

结果：`7/7 PASS`（含 C0-Z 复审后的 U1-R0 schema/语义门测试）。

## Diff check（合流语义）

高冲突文件均在位且非整文件覆盖回退：

| 语义 | 证据位置 |
|---|---|
| `modelOverride` + 跨模型空 LoRA | `web/src/lib/canvas/generation-plan.ts` |
| Outpaint preflight / source lock / Shared ExecutionPlan | `web/src/pages/canvas/project.tsx` |
| 续接模型选择、提交防重入 | `web/src/components/canvas/canvas-node-outpaint-dialog.tsx` |
| 中英文资产诊断后缀、`preflightComfyOutpaint` | `web/src/services/api/comfy.ts` |
| source provenance / ipadapter_template / 不可执行 binding 过滤 | `web/src/lib/canvas/generation-runtime-plan.ts` |
| stale 一跳传播 | `web/src/lib/canvas/generation-dependencies.ts` |
| disabled LoRA profile 过滤 | `web/src/services/api/comfy.ts` presets 解析 |

边界保持：

- 真实 `.uat/u1-outpaint/u1-r0/manifest.json` **不存在**（`PRE_REG_INCOMPLETE`）
- `web/src` 无 Fooocus 产品路径
- C0-3 receipt v2 证据 manifest SHA 复算命中：`272a11214cb8b33c4d62a61152ef7142b286f519e0f529ddb9323b93100b9f54`
- FaceID / 多阶段 live 仍属 Gate B

## 独立 review

| 轮次 | 结论 | 处理 |
|---|---|---|
| R1 | FAIL：P0×1 + P1×3（FROZEN schema 松、无真 schema 校验、无 A/B 零差异、无可评 cell 不一致） | 已修 |
| R2 | FAIL：P0×1（FROZEN requestHashInput 过松 / 伪最小样例） | 已修 |
| R3 | FAIL：P0×1（cell 身份可篡改）+ P1×1（顶层未对齐） | 已修 |
| R4 | FAIL：P1×2（matrix 未锁、目标尺寸未锁） | 已修 |
| R5 | **PASS**；Blocking 0 / P0 0 / P1 0 | 关闭 |

R5 结论：Gate 0 可标 `DONE`。

## C0-Z 合同加固落点

1. `manifest.schema.json`：`status=FROZEN` 条件强制；`requestHashInput` 完整形状；artifact 要求 `targetWidth/targetHeight`
2. `validateFrozenManifestSemantics`：固定 18-cell 身份矩阵、顶层 matrix、model/sampling/workflow/mutator/prompt/artifact/尺寸对齐、A/B LoRA 对照与 hash 复算
3. `validateAbRequestHashInputDiff`：A/B 仅允许 LoRA 字段差异
4. `validateAttemptsIntegrity`：允许全终态无可评 cell
5. 离线测试：Ajv draft-2020-12 真校验 + 多组负例

## 出口

- C0-Z = `DONE`
- Gate 0 = `DONE`
- Gate A = 仍 `BLOCKED`，直至真实 U1-R0 `manifest.json` 冻结后再开 U1-R0-P / 18 cells
- 未 commit / push；未改 Mission_manager / Windows ComfyUI
