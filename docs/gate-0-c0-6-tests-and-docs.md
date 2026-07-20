# Gate 0 / C0-6 测试与文档证据

## 范围

将 PoC 中完整的 U1-R0 `manifest / request hash / attempt / pair / taxonomy` 执行合同持久化到主线；同步总控与进度文档；合并可并入的合同测试。  
**不**生成带真实资产 SHA 的实验 `manifest.json`，**不**提交 18 cells。

## 落盘产物

| 路径 | 说明 |
|---|---|
| `docs/u1-r0-execution-contract.md` | U1-R0 完整执行合同（权威专项文档） |
| `.uat/u1-outpaint/u1-r0/README.md` | 目录状态与开跑前置 |
| `.uat/u1-outpaint/u1-r0/manifest.template.json` | 18 cells / 9 pairs 骨架；`status=TEMPLATE` |
| `.uat/u1-outpaint/u1-r0/taxonomy.profile.json` | 冻结 taxonomy 标签、去重优先级、severity 权重 |
| `.uat/u1-outpaint/u1-r0/schemas/*.schema.json` | manifest / request-hash-input / attempts / pairs / pair-report / taxonomy |
| `web/src/lib/canvas/u1-r0-contract.ts` | 矩阵、hash、pair 裁决、attempt 完整性纯函数 |
| `web/tests/u1-r0-contract.test.ts` | 离线合同不变量测试 |

## 测试合流

| 项目 | 决策 |
|---|---|
| 主线 generation / receipt / dependencies / capabilities 测试 | 保留 |
| 新增 `u1-r0-contract.test.ts` | 合入 |
| PoC `illustrious-outpaint-recipe.test.ts` + Fooocus recipe | **不合入**（合同明确禁止 Fooocus 作为 U1-R0 链路；属候选实验代码，非产品路径） |

## 空 LoRA 可证明性

- C0-3 已具备协议能力：bare receipt `5d440fec…` → `actualLoras=[]` + `loraEvidence.status=complete`。  
- 模板 `emptyLoraProofPolicy` 强制开跑时 B cell 必须 complete 空集合。  
- `incomplete` / `unknown` 不得当作裸模证据。  
- 历史 A2R2 仍仅为请求级线索。

## C0-Z 复审修复（合同闭环）

独立 review 发现 C0-6 合同层缺口后已回修：

1. **P0**：`manifest.schema.json` 对 `status=FROZEN` 增加 `if/then` 条件，强制 source/model/LoRA/prompt/sampling/artifacts/workflow/mutator/codeFingerprint 与 18 个 request hash 字段非空且完整；`requestHashInput` 内嵌完整 request-hash 形状；伪 FROZEN / 空 hash input 不得通过。
2. **P0 语义门**：`validateFrozenManifestSemantics` 校验 cell 与 hash 的 direction/seed/group/LoRA 对齐、requestSha256/JCS 可复算，以及 9 个 A/B pair 仅允许 LoRA 差异。
3. **P1-1**：base schema 兼容 TEMPLATE 的 null 字段；离线测试用 Ajv draft-2020-12 真校验 TEMPLATE / 伪 FROZEN 失败 / 最小合法 FROZEN。
4. **P1-2**：实现 `validateAbRequestHashInputDiff`，A/B 仅允许 `loras` / `lora_keys` / `actualLoras` 差异。
5. **P1-3**：`validateAttemptsIntegrity` 允许 cell 全部终态 `FAILED|CANCELLED` 且无 selected 的无可评分支。

## 状态

- C0-6 = `DONE`（含 C0-Z 复审合同修复）  
- C0-Z = `DONE` / 见 `docs/gate-0-c0-z-acceptance.md`  
- U1-R0-P 合同/schema = 已落盘；真实 `manifest.json` = 未冻结  
- U1-R0 实验 = 仍 `BLOCKED / PRE_REG_INCOMPLETE`  
- Gate 0 = `DONE`  
- Gate A = 仍 `BLOCKED` 至真实 U1-R0 manifest 冻结  

按项目规则：本批可不跑全量 `npm test` / build；合同测试可按需单独执行  
`cd web && npx tsx --test tests/u1-r0-contract.test.ts`。
