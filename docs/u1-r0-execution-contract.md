# U1-R0 Illustrious 裸模 A/B 执行合同

> 权威专项合同。总控 `docs/infinite-canvas-unified-development-plan.md` 只保留状态与入口；本文件保存完整可执行细节。  
> 来源：PoC `illustrious-outpaint` 执行合同 + 主线 Gate 0 C0-3 receipt v2 证据边界。  
> **本文件 = 合同落盘，不等于实验已开跑，也不等于 `manifest.json` 已冻结真实资产 SHA。**

## 1. 定位与状态

| 项 | 定义 |
|---|---|
| 目的 | 同一 Illustrious checkpoint 上，验证附加 6 LoRA 是否放大 masked Outpaint 的第二主体、相机、饰品、解剖错误与背景异物 |
| A | 冻结的 6 LoRA recipe |
| B | 同 checkpoint，显式 `lora_keys=[]` |
| 链路 | 现有 **masked Outpaint**（pad + 方向软蒙版 + Differential Diffusion + `ImageCompositeMasked` 像素回贴 + `reference_mode=none`）；**不是**纯 txt2img |
| 禁止 | Fooocus、IPAdapter、ControlNet、FaceDetailer、prompt rewrite、profile 自动注入 trigger words、manifest 外参数变化 |

状态必须拆开：

| 阶段 | 当前 | 说明 |
|---|---|---|
| U1-R0-P 预注册合同 | `READY`（C0-6 合同/schema 已落盘） | 本文件 + `.uat/u1-outpaint/u1-r0/schemas/*` + `manifest.template.json` |
| 实验用 `manifest.json` | **未冻结** | 须写入真实 source/checkpoint/LoRA/pad-mask/workflow/code 指纹后才算预注册完成 |
| U1-R0 实验 | `BLOCKED / PRE_REG_INCOMPLETE` | 真实 manifest 未落盘、A/B 资产 SHA 未冻结前禁止提交 18 cells |
| 空 LoRA 可证明性 | **协议已具备**（C0-3） | bare 样本 `5d440fec…` 证明 `actualLoras=[] + loraEvidence.status=complete`；开跑时每个 B cell 仍须各自拿到 complete 空集合回执 |

历史 A2R2 只是请求级线索：旧 receipt 无 completeness，不得替代本矩阵，也不得写成「LoRA 已被排除」的因果结论。

## 2. 权威路径

| 路径 | 用途 |
|---|---|
| `.uat/u1-outpaint/u1-r0/manifest.json` | 实验冻结 manifest（**尚未创建**；生成后禁止中途改参） |
| `.uat/u1-outpaint/u1-r0/manifest.template.json` | 结构模板与 plannedCells 骨架，不含真实资产 SHA |
| `.uat/u1-outpaint/u1-r0/schemas/` | JSON Schema：manifest / request-hash-input / attempts / pairs / taxonomy / pair-report |
| `.uat/u1-outpaint/u1_qa/` | U1-QA v1 工具与 `threshold_profile_v1.json` |
| `web/tests/u1-r0-contract.test.ts` | 合同不变量离线校验（矩阵、hash 投影、pair 裁决、taxonomy 去重、attempt 完整性） |

## 3. 首轮矩阵

```text
directions = up / down / outward
seeds      = 424242 / 424243 / 777001
groups     = A / B
plannedCells = 18
plannedPairs = 9   # 每 (direction, seed) 一个 pair slot
```

- 只有 `up/down/outward` **各自**独立 bare win 后，才可为 `left`/`right` 各追加 6 cells、3 pairs。
- 任何方向不得用重复 seed 或重复 pair 凑满门槛。
- 每方向 bare win 充要条件：恰有 3 个有效 pair，且 `B_WIN >= 2` 且 `A_WIN = 0`。

## 4. `manifest.json` 必须冻结的字段

1. source 原图 SHA-256  
2. checkpoint：capability ID、checkpoint ID、物理文件 SHA-256  
3. A 组 6 LoRA：key、物理 SHA、加载顺序、model/clip strength、profile ID/version/hash；B 组为空列表  
4. 每方向 compiled positive / negative **完整原文** + 各自 SHA-256  
5. sampler、scheduler、steps、CFG  
6. 目标尺寸、direction、seed、denoise、seam、`extensionRatio`  
7. base / pad / mask 各自 SHA-256  
8. WorkflowBinding ID/version/hash；mutator 有序列表及版本  
9. 代码 commit 与 worktree diff fingerprint  
10. QA profile、threshold profile、taxonomy 的 ID/version/hash，以及 pair report schema version  
11. `plannedCells[]{cellId,direction,seed,group,requestSha256}`  
12. `requestHashSpec = "u1-r0-request-v1"`；每个 cell 的 `requestHashInput` 与 `requestHashInputJcsUtf8Base64`

A/B 结构化 request diff：除 `lora_keys` 及其解析到的实际 LoRA 资产外，diff 必须为空。  
若 profile 会自动追加 trigger words：A/B 必须固定同一 compiled positive/negative，并禁止自动追加；否则实验保持 `PRE_REG_INCOMPLETE`。

## 5. `requestSha256` 规范

- `requestHashSpec` 固定为 `"u1-r0-request-v1"`。
- 每个 cell 的 `requestHashInput` 唯一顶层结构：

```json
{
  "spec": "u1-r0-request-v1",
  "execution": {
    "model": { "capabilityId": "...", "checkpointId": "...", "sha256": "..." },
    "loras": [{ "key": "...", "modelStrength": 0, "clipStrength": 0, "sha256": "..." }],
    "sampler": "...",
    "scheduler": "...",
    "steps": 0,
    "cfg": 0,
    "direction": "up|down|outward|left|right",
    "seed": 0,
    "denoise": 0,
    "seam": 0,
    "extensionRatio": 0,
    "dimensions": { "width": 0, "height": 0 },
    "workflow": { "bindingId": "...", "version": "...", "sha256": "..." },
    "mutators": [{ "id": "...", "version": "..." }],
    "referenceMode": "none"
  },
  "inputs": {
    "positive": { "text": "...", "sha256": "..." },
    "negative": { "text": "...", "sha256": "..." },
    "base": { "sha256": "..." },
    "pad": { "sha256": "..." },
    "mask": { "sha256": "..." }
  }
}
```

- 序列化：RFC 8785 JSON Canonicalization Scheme（JCS）UTF-8。  
- `requestSha256 = SHA-256(JCS UTF-8(requestHashInput))`。  
- manifest 同时保留 `requestHashInputJcsUtf8Base64` 与其 SHA，供独立复算。  
- **排除**：request ID、时间戳、trace、队列/重试标识、认证、传输 URL 等 transport-only 字段。  
- 数组严格保留 manifest 声明顺序。

## 6. 结果合同

```text
attempts[]{
  attemptId, cellId, requestSha256,
  status,                # SUCCEEDED | FAILED | CANCELLED
  failureClass?,         # 见封闭枚举
  replacesAttemptId?,
  selected               # boolean
}

pairs[]{
  pairId, aCellId, bCellId,
  aAttemptId, bAttemptId,  # 无可评侧为 null
  pairDisposition,         # B_WIN | A_WIN | TIE | INVALID
  comparisonReasons
}
```

### 6.1 计数

- `attemptCount = attempts.length`  
- `plannedPairs = pairs.length = planned slots`（首轮 9）  
- `evaluablePairs = count(pairDisposition != INVALID) <= plannedPairs`

### 6.2 attempt 完整性

- 每个 planned cell 恰有一个 `selected=true`，或该 cell 全部 attempts 以终态明确标记无可评。  
- `status`：`SUCCEEDED` | `FAILED` | `CANCELLED`。  
- `failureClass` 封闭枚举：  
  `gateway_unavailable` · `gateway_internal_error` · `artifact_storage_error` ·  
  `model_or_quality_reject` · `timeout_unknown_cause` · `request_or_workflow_validation_error` ·  
  `asset_or_receipt_proof_missing` · `user_cancelled` · `protocol_deviation`  
- `SUCCEEDED`：无 `failureClass`、无 `replacesAttemptId`。  
- `FAILED`：恰有一个 `failureClass`。  
- `CANCELLED`：`failureClass=user_cancelled`，无 `replacesAttemptId`。  
- `replacesAttemptId` 仅允许 terminal `FAILED`，且 `failureClass` 属于  
  `gateway_unavailable` | `gateway_internal_error` | `artifact_storage_error`。  
- selected 的 `requestSha256` 必须等于 `plannedCells[].requestSha256`。  
- replacement 链无环；前驱同 `cellId`、同冻结 hash；每个前驱至多一个直接 replacement。  
- 任何参数/哈希漂移 = `protocol_deviation`，不得作 replacement 或 selected evidence。

### 6.3 pair 完整性

- 首轮 9 个 slots：`(direction ∈ {up,down,outward}) × (seed ∈ {424242,424243,777001})`。  
- 每 slot 恰有一个 pair（含 `INVALID`）。  
- 只有 selected attempts 可被 pair 引用；某侧无可评时 attempt ID 为 `null` 且 disposition 必须 `INVALID`。  
- 所有 attempts（含被替换）全量保留审计。

### 6.4 pair 裁决算法（有序穷尽，首条命中即返回）

| 顺序 | 条件 | disposition |
|---|---|---|
| 0 | 数据/图片不可读，或任一侧缺 selected attempt | `INVALID` |
| 1 | protected hard gate：仅 B 违反 | `A_WIN` |
| 2 | protected hard gate：仅 A 违反 | `B_WIN` |
| 3 | protected hard gate：双方违反 | `INVALID` |
| 4 | 其它 deterministic hard fail：仅 B | `A_WIN` |
| 5 | 其它 deterministic hard fail：仅 A，且 B 守门非劣 | `B_WIN` |
| 6 | 其它 deterministic hard fail：仅 A，但 B 守门退化 | `TIE` |
| 7 | 其它 deterministic hard fail：双方都有 | `INVALID` |
| 8 | 双方无 hard fail：B severity 至少少 1 且 B 守门非劣 | `B_WIN` |
| 9 | 双方无 hard fail：A severity 至少少 1 且 A 守门非劣 | `A_WIN` |
| 10 | 维度冲突或两边相同 | `TIE` |
| 11 | 数据有效但不支持单边获胜 | `TIE` |

- severity 权重固定：`block=3`、`error=2`、`warn=1`；每个去重后 physical finding 计一次。  
- protected hard gate 与其它 hard fail 由冻结 threshold profile 分开列举，A/B 对称。  
- `comparisonReasons` 必须记录命中顺序、hard-gate/hard-fail 状态、severity 与守门非劣判断。

## 7. Taxonomy

Canonical 标签（禁止斜杠复合标签）：

- `second_subject`
- `camera_prop`
- `anatomy_break`
- `protect_violation`
- `hard_seam`
- `bg_incoherent`
- `unexpected_object`

规则：

- `unexpected_object.subtype` 仅：`extra_face` | `extra_limb` | `unexpected_accessory` | `other`（不含 `camera`）。  
- 相机/支架等统一 `camera_prop`。  
- extra face 构成第二主体：`second_subject` + `subtype=extra_face`。  
- 每个物理 finding 只记一次；冲突优先级：  
  `second_subject > camera_prop > anatomy_break > unexpected_object`。  
- 每个 finding 必须绑定 region + crop + evaluator；无区域证据的文字不算 finding。

U1-QA v1 现有标签若名称不同，预注册时在 threshold profile 中显式对齐并冻结；manifest 落盘后实验中不得改 taxonomy/version。

## 8. 空 LoRA 可证明性（开跑门）

开跑时每个 **B** cell 必须同时满足：

1. 请求：`comfyExtra.lora_keys=[]`（或等价显式空）。  
2. ExecutionPlan：`values.loras=[]` 且 source 为 operation/explicit。  
3. Gateway receipt v2：`actualLoras=[]` **且** `loraEvidence.status=complete`。  

`incomplete` / `unknown` 不得当作裸模证据。  
C0-3 已用可复算 bare 样本证明协议能力；**不等于**本矩阵 18 cells 已具备各自 complete 回执。

## 9. 决策树与止损

| 分支 | 条件 | 动作 |
|---|---|---|
| A | up/down/outward 三方向都 bare wins | 扩 left/right；各自 2/3 后才可将裸模设为 U1-R 默认 baseline |
| B | 仅部分方向 bare wins | 只在获胜方向用方向化 bare profile；其余保留 6 LoRA 进 U1-R |
| C | 无方向获胜或 B 明显退化 | 保留 6 LoRA，关闭裸模假设，继续 U1-R 工作流/prompt/接缝 |
| D | 大量失败 | 任一方向有效 pair < 3，或三方向 `INVALID>=3`，或 A/B 硬失败覆盖 ≥2 方向 → 停调 LoRA，回工作流/垫图/蒙版路线 |

止损：首轮固定 18 planned cells；结果前不扩 left/right；中途不改 manifest、不 cherry-pick。

## 10. 与 Gate 0 / Gate A 关系

- C0-6 出口：本专项合同 + schema + 模板 + 离线合同测试落盘；状态与 TODO/pending-test/CHANGELOG/Atelier 同步。  
- **不**在 C0-6 生成带真实资产 SHA 的 `manifest.json`，**不**提交 GPU cells。  
- C0-Z / Gate 0 已 DONE；Gate A 下一步进入 U1-R0-P「生成并冻结真实 manifest」与 18 cells。  
- U1-B/C 默认等 U1-Z；U1-R0 单项结论不自动解除。

## 11. 测试合流边界

| 来源 | 处理 |
|---|---|
| 主线 `generation-plan` / `generation-runtime-plan` / `comfy-capabilities` / receipt / dependencies | 保留（含 C0-4/C0-5 语义） |
| PoC `illustrious-outpaint-recipe.test.ts` + Fooocus recipe | **不并入产品路径**；合同明确禁止 Fooocus 作为 U1-R0 链路 |
| 新增 `u1-r0-contract.test.ts` | 校验矩阵生成、request hash 投影、pair 裁决、taxonomy 去重、attempt/pair 完整性 |

---

**修订规则**：合同字段变更必须升 schema version / `requestHashSpec`，并同步总控入口与 Atelier 状态索引；不得静默改枚举。
