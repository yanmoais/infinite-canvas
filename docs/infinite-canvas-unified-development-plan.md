# Infinite Canvas 统一设计与开发计划 v1.0

> **文档性质**：跨 Infinite Canvas、Mission_manager Gateway、Windows ComfyUI 的唯一总控计划  
> **当前主线**：Gate A Outpaint（U1-R0-P 已冻结；下一步 18 cells）  
> **领域文档**：`story-workflow-prd.md`、`pose-control-development-plan.md`、`character-atelier-design.md`

---

## 1. 总控规则

### 1.1 唯一权威

- 本文件只维护跨域状态、依赖、Gate、当前批次和验收出口。
- 领域文档只维护各自产品语义与专项设计，不再维护平行总排期。
- `docs/content/docs/progress/todo.mdx` 只摘录当前可执行批次。
- `pending-test.mdx` 只记录已经实现、仍待人工验证的变化。
- 实验过程和产物留在 `.uat/`；物理模型、工作流、哈希和 smoke 留在 Mission_manager Registry。

### 1.2 工作区边界

| 工作区 | 定位 | 规则 |
|---|---|---|
| `main`：Infinite Canvas 主工作区 | 原整套开发计划与后续开发基线 | 所有正式合流均以它为母版 |
| `poc/illustrious-outpaint` 隔离工作树 | Illustrious Outpaint 候选实现与实验计划 | 只提供经过 review 的增量，不得整目录覆盖主线 |
| Mission_manager | 共享 Gateway、Registry、Workflow 与运行回执 | 改动会影响所有连接 `127.0.0.1:8080` 的画布会话 |

强制约束：

- 禁止主线与 PoC 同时修改交叉文件。
- 禁止用任一工作树整目录覆盖另一工作树。
- 交叉文件必须以主线为底做逐文件三方合并，并保留两边有效语义。
- 画布前端试跑必须使用不同端口或独立浏览器 profile；同一 origin 会共享 `infinite-canvas` IndexedDB/localStorage。
- Gateway 实验必须冻结 Registry、Workflow、Gateway 代码和运行时资产版本；共享 8080 的临时变化不能直接作为可归因证据。

### 1.3 状态定义

| 状态 | 含义 |
|---|---|
| `DONE` | 已实现并达到该阶段工程出口 |
| `PENDING_UAT` | 已实现，等待 BOSS 实图或交互验收 |
| `READY` | 契约和前置明确，可以开工 |
| `IN_PROGRESS` | 已开工，尚未达到出口 |
| `BLOCKED` | 有明确前置条件未满足 |
| `DEFERRED` | 当前不进入主线 |

状态列只使用上表基础枚举；阻塞原因、暂停原因和历史处置写入前置或证据列，不再拼接成复合状态。

---

## 2. 产品与架构边界

### 2.1 产品关系

独立生图、Inpaint、Outpaint、Pose、Character Atelier 与 Story 必须保持独立入口，并复用同一生成底座：

```text
产品入口
  → Shared Generation Core
  → OperationProfile + ExecutionPlan
  → Capability / Workflow Adapter
  → Mission_manager Registry
  → Windows ComfyUI / Model API
```

Story 是高级编排调用方，不是图片能力的容器。基础能力在没有 `storyId`、`sceneId`、`shotId` 时也必须完整运行。

### 2.2 四层契约

| 层 | 权威内容 | 禁止事项 |
|---|---|---|
| 产品语义 | `GenerationIntent`、`CompositionContext`、`PoseAsset`、`ReferenceBinding` | 写入物理模型文件名 |
| 共享编译 | `PromptCompiler`、`OperationProfile`、`ExecutionPlan`、`QualityGate` | Story/Atelier 定义平行类型 |
| 能力路由 | `CapabilityRegistry`、`WorkflowBinding`、Preflight、Fallback | 用未验证能力冒充 ready |
| 物理执行 | Registry、Workflow JSON、节点、模型、资产哈希 | 把计划值冒充实际执行值 |

### 2.3 不可破坏契约

- `CanvasOperationKind` 与 `MediaGenerationType` 分离。
- 引用使用带角色、revision 和 content hash 的 `ReferenceBinding[]`。
- `ExecutionPlan` 记录编译值、来源、能力决策、WorkflowBinding 和资产快照。
- Exact Replay 克隆历史计划，只叠加当前 Preflight；缺资产必须显式失败。
- 上游节点变化只将真实引用它的直接下游标记为 `stale`。
- Gateway receipt 区分 planned 与 actual；多阶段执行以 `stages[]`、`primaryStageId`、`finalStageId` 为权威。
- `hashStatus=registered` 只表示 Registry 已登记哈希，不表示本次运行前重新校验过物理文件。
- Shared Core 不导入 Story 类型；Story、Pose、Atelier 只能提交语义覆盖。

---

## 3. 唯一 Gate 队列

Gate 严格按顺序推进。维护性文档整理和明确缺陷修复不得改变任何 Gate 状态，也不得使用共享 Gateway 产出下一 Gate 的验收证据。

| Gate | 状态 | 目标 | 前置 / 出口 | 当前动作 |
|---|---|---|---|---|
| **Gate 0 / C0 收敛** | `DONE` | 收敛主线、PoC 与共享 Gateway，建立无污染开发基线 | 出口：交叉文件合流、Gateway 结论纠偏、测试与独立 review 通过 | C0-Z 已关闭；见 `docs/gate-0-c0-z-acceptance.md` |
| **Gate A / U1 Outpaint** | `IN_PROGRESS` | 完成裸模归因、方向回修与 BOSS 终验 | 前置：Gate 0；出口：`QUALIFIED` / `PARTIAL` / `REJECTED` | U1-R0-P 已冻结；提交 18 cells |
| **Gate B / U2-E Windows edit smoke** | `BLOCKED` | 验证 mask/inpaint、FaceID fallback、framing retry、part refine | 前置：Gate A 已取得 `QUALIFIED` / `PARTIAL` / `REJECTED` 合法出口；工程已完成但 UAT 受 Gate A 阻塞 | 收集真实回执与视觉证据 |
| **Gate C / U2-D 自动引用** | `BLOCKED` | Qwen Edit、BiRefNet、Florence2 自动消费能力专用引用 | 前置：Gate A 有角色基线或失败清单；Gate B 完成 | 冻结引用角色与字段映射 |
| **Gate D / U3 Pose Runtime** | `BLOCKED` | 证明 FaceID × ControlNet 真实生产组合可运行 | 前置：Gate C；出口：四格矩阵与回退证据 | 运行时探针与插件迁移评估 |
| **Gate E / U4 Pose MVP** | `BLOCKED` | 独立 PoseAsset、PoseRenderSpec、面板和共享 Adapter | 前置：Gate D | 单人姿势闭环 |
| **Gate F / M5 Character Atelier** | `BLOCKED` | 固定角色后重启评测集，完成拆解、保护、组合和能力路由 | 前置：Gate E 已完成 | 重筛评测集后继续 P0B/P1 |
| **Gate G / M6 Story P0** | `BLOCKED` | 只建链与确定性编译，不建立第二套生成链 | 前置：Gate F 已取得完整合法出口 | 最后接入 Story 编排 |

维护事项只允许处理上游同步记录、明确缺陷修复、文档同步和独立 review；不得启动后续 Gate、修改其运行时基线或产出验收证据。

---

## 4. Gate 0：主线 / PoC / Gateway 收敛

### 4.1 当前风险结论

1. 两个 Git worktree 相互隔离，未提交文件不会自动覆盖。
2. 两边存在大量同名且内容不同的交叉文件，整目录覆盖会丢失有效开发成果。
3. 当前 8080 Gateway 来自 Mission_manager，Registry 与 Gateway 的未提交变化会影响两个画布会话。
4. Gateway Registry 中历史 Outpaint profile 把 A2R2 误写成“证明 LoRA 不是主因”；该结论超出证据边界。
5. ~~前端读取 `recommended_lora_profiles` 时未按 `enabled:false` 过滤~~：历史风险，已由 C0-2 关闭；当前解析与推荐函数均过滤 disabled profile。
6. 同一浏览器 origin 会共享画布项目、模型渠道和 AI 配置，PoC 试跑可能改写主线本地数据。

### 4.2 合流矩阵

| 类别 | 主线保留 | PoC 候选引入 | 合流方式 |
|---|---|---|---|
| Shared Core | dependency stale 传播、PromptCompiler、ExecutionPlan 基线 | source provenance 修复、IPAdapter binding 选择 | 以主线类型为底逐项补语义 |
| Outpaint UI | 原画布数据、提示词与现有续接逻辑 | 续接模型选择、跨模型提示、source lock | 合并交互，不替换整页 |
| 执行计划 | 源配方继承与 Exact Replay | `modelOverride`、跨模型显式空 LoRA | 增加 operation-level 覆盖，不破坏同模型继承 |
| Capability | 通用模型 Preflight | operation-level Outpaint Preflight、资产 ID 规范化 | 合并为同一 API 客户端 |
| Runtime plan | 主线引用、stale、capability snapshot | 临时上传引用映射回真实 source node | 保留真实 provenance |
| Illustrious | 主线通用模型能力 | recipe、跨模型 PoC 与专项测试 | 只作为候选能力，不成为隐式默认 |
| 文档 | 主线总控、Pose、Story、Atelier | U1-R0 实验合同与 PoC 证据边界 | 主线总控吸收状态；专项细节独立保存 |
| Gateway | 当前 Registry/Workflow/receipt 基础 | PoC 所需 actual-LoRA 证明 | 先纠偏并形成候选基线，证据合同验证后再最终冻结 |

### 4.3 高冲突文件

下列文件禁止复制覆盖，必须逐个 review：

```text
web/src/pages/canvas/project.tsx
web/src/services/api/comfy.ts
web/src/lib/canvas/generation-plan.ts
web/src/lib/canvas/generation-runtime-plan.ts
web/src/types/generation.ts
web/src/components/canvas/canvas-node-outpaint-dialog.tsx
docs/infinite-canvas-unified-development-plan.md
docs/content/docs/progress/todo.mdx
docs/content/docs/progress/pending-test.mdx
CHANGELOG.md
```

### 4.4 当前批次 DAG

| 任务 | 状态 | 内容 | 出口 |
|---|---|---|---|
| `C0-1` 冻结边界 | `DONE` | 双工作树、Mission_manager、8080 进程、共享文件指纹和浏览器隔离边界已记录；BOSS 已确认继续完成 v0.9.0 merge | merge commit `62738dd2` 已创建，`MERGE_HEAD` 清除；处置后 status 快照已落盘 |
| `C0-2` Gateway 纠偏 | `DONE` | 失败 profile notes 已收敛为请求级观察；前端过滤 disabled；Gateway 候选拒绝显式 disabled ID | 候选基线、静态检查与独立 review 通过；C0-2 当时未重启共享 8080，后续加载状态以 C0-3 冻结证据为准 |
| `C0-3` 证据合同与最终冻结 | `DONE` | receipt v2 已由共享 Gateway 加载；bare、动态 LoRA、pre-submit `unknown` 与 invalid-preset planned/actual/`fallback.preset` 四类在线合同通过；HTTP/持久化一致性以 `.uat/gate-0/c0-3-receipt-v2/evidence-manifest.json` 可独立复算 | Registry `a0ff5c…`、Gateway `83a767…`、71-workflow 集合 `c0c4e4…` 命中冻结值；FaceID/多阶段 live 留 Gate B |
| `C0-4` Shared Core 合流 | `DONE` | `OperationProfile.modelOverride`、跨模型显式空 LoRA、source node provenance、`ipadapter_template` 选择、`preflightComfyOutpaint` 与资产 ID 规范化已合入；复审 P0 已修：识别 Gateway 中文诊断后缀 `(ComfyUI 未扫到)` / `(Loader 无枚举)`；P1 已修：不可执行 binding 不再写入 plan | 类型和计划只有一套权威；未改任何 UI 调用链；证据见 `docs/gate-0-c0-4-shared-core-merge.md` |
| `C0-5` UI 调用链合流 | `DONE` | Outpaint 对话框接入续接模型选择；`project.tsx` 接 source lock、`preflightComfyOutpaint`、跨模型 `modelOverride`/显式空 LoRA；主线默认词/直译提示词路径与 stale 传播保留，编译后写 Shared ExecutionPlan | 证据见 `docs/gate-0-c0-5-ui-callchain-merge.md` |
| `C0-6` 测试与文档 | `DONE` | U1-R0 完整合同/schema/模板与离线测试已落盘；PoC Fooocus recipe 测试不合入；真实 `manifest.json` 未冻结 | 证据见 `docs/gate-0-c0-6-tests-and-docs.md`、`docs/u1-r0-execution-contract.md` |
| `C0-Z` 独立验收 | `DONE` | 约定测试 7/7、diff check 与五轮独立 review 终轮 PASS；C0-6 合同加固（FROZEN schema/语义门/A-B 零差异/无可评 cell） | Gate 0 `DONE`；Gate A 可进入真实 manifest 冻结，但 18 cells 仍待预注册完成 |

依赖关系：

```text
C0-1 → C0-2 → C0-3 → C0-4 → C0-5 → C0-6 → C0-Z
```

---

## 5. Gate A：Outpaint 验收

### 5.1 当前状态

| 阶段 | 状态 | 证据边界 | 下一动作 |
|---|---|---|---|
| U1-A 历史五方向矩阵 | `DONE` | 五方向已提交；BOSS 已否定整包，不再重复终验 | 仅作为被否决的失败基线 |
| U1-QA 结构化验收工具 | `DONE` | geometry crops、seam continuity、空间暗区、相对色偏、qa-report v1 已落地 | 作为后续统一证据基线 |
| U1-R0-P 裸模预注册 | `DONE` | 真实 `manifest.json` 已 `FROZEN`；Ajv + `validateFrozenManifestSemantics` 通过；证据见 `docs/gate-a-u1-r0-p-manifest-freeze.md` | 禁止改参后复用同一 manifestId |
| U1-R0 裸模 A/B | `READY` | 冻结 manifest 已就绪；历史 A2R2 仍不得替代；B cell 运行时仍须 complete 空 LoRA | 提交首轮 18 cells |
| U1-R 定向回修 | `BLOCKED` | up 多轮与 workflow 实验仍未放行；等待 U1-R0 归因结论 | 先完成 U1-R0 预注册与 18 cells，再按方向继续 |
| U1-Z BOSS 终验 | `BLOCKED` | 只看 U1-R 后候选、失败清单、总尝试分母与原图证据 | U1-R 收口后执行 |
| U1-B 全身重构 / U1-C 对抗矩阵 | `BLOCKED` | 不因 U1-R0 单项结论自动解除 | 默认等待 U1-Z |

### 5.2 U1-R0 裸模实验

目的：判断同一 Illustrious checkpoint 在现有 masked Outpaint 链上，显式空 LoRA 是否减少第二主体、相机、饰品、解剖错误和背景异物。

固定对照：

- A：当前冻结的六 LoRA recipe。
- B：同 checkpoint，显式 `lora_keys=[]`。
- A/B 仅允许 LoRA 集合和对应实际 LoRA 资产不同。
- source、compiled prompt/negative、方向、seed、denoise、seam、extension ratio、pad/base/mask、workflow、mutator 和代码指纹必须一致。
- 保持现有 masked Outpaint，不改成纯 txt2img；不引入 Fooocus、IPAdapter、ControlNet、FaceDetailer、prompt rewrite 或 trigger word 自动注入。

首轮矩阵：

```text
directions = up / down / outward
seeds      = 424242 / 424243 / 777001
groups     = A / B
plannedCells = 18
plannedPairs = 9
```

只有前三方向均独立 bare win，才为 left/right 各追加 6 cells、3 pairs。任何方向不得用重复 seed 或重复 pair 凑满门槛。

开跑前置：

1. 完整执行合同与 schema 已由 C0-6 落盘（`docs/u1-r0-execution-contract.md`、`.uat/u1-outpaint/u1-r0/schemas/`）；模板见 `manifest.template.json`（`TEMPLATE` ≠ 冻结）。
2. 生成并冻结真实 `.uat/u1-outpaint/u1-r0/manifest.json`：source/checkpoint/LoRA/compiled prompt/参数/pad-mask/workflow/mutator/code/QA profile 的版本与 SHA。
3. Gateway receipt 能证明实际 LoRA 完整集合；仅有请求 `lora_keys=[]` 或 ExecutionPlan 空数组不够（协议证据见 C0-3 bare `5d440fec…`）。
4. 结果数组遵循已冻结的 `plannedCells[]`、`attempts[]`、`pairs[]` 与 `requestHashSpec=u1-r0-request-v1`。
5. `requestSha256` 使用版本化 allowlist projection 和 RFC 8785/JCS UTF-8；排除 request ID、时间戳和 trace 等传输字段。

结果规则：

- 每个 `(direction, seed)` 只有一个预定 pair slot；`INVALID` 也必须记录。
- 每 cell 只有一个 selected attempt 或显式不可评终态；pair 只能引用 selected attempt。
- replacement 只能发生在同 cell、同冻结 request hash，并仅允许纯基础设施失败。
- canonical taxonomy：`second_subject`、`camera_prop`、`anatomy_break`、`protect_violation`、`hard_seam`、`bg_incoherent`、`unexpected_object`。
- finding 去重优先级：`second_subject > camera_prop > anatomy_break > unexpected_object`。
- 每方向恰有 3 个有效 pair，`B_WIN >= 2` 且 `A_WIN = 0`，才算 bare win。
- 有效证据不足、大量 INVALID 或双方跨方向硬失败，进入 workflow/pad-mask 诊断，不继续调 LoRA。

历史 A2R2 边界：B 组请求与 ExecutionPlan 显式空 LoRA，单 seed 结果更绿；旧 receipt 无 completeness，因此只属于请求级线索，不能证明运行时实际空 LoRA，也不能得出 LoRA 已被排除的因果结论。

### 5.3 U1-R 与 U1-Z

- 方向回修顺序由 U1-R0 结果重新确认，不沿用未经归因的无限调参链。
- 每方向预注册有限修复假设和 GPU 预算；超预算记为 `known_failure`。
- 同 seed A/B 后至少增加两个预声明 seed；方向锁定必须通过视觉 hard gate。
- U1-Z 只检查最终候选、失败方向、总尝试数、失败数、选择规则、receipt、metrics 与 qa-report。
- 合法出口只有 `QUALIFIED`、`PARTIAL`、`REJECTED`。

证据入口：`.uat/u1-outpaint/`。历史逐轮参数、prompt ID 和指标不再复制到总控。

---

## 6. 后续 Gate

### 6.1 Gate B：Windows 真实编辑 smoke

C0-3 已在线验证 bare、动态 LoRA 与 pre-submit `unknown` 核心合同；FaceID opaque/incomplete、多阶段聚合与 fallback 当前只有静态合同覆盖，其真实 Windows live 证据明确留在本 Gate。

验证：

- mask/inpaint；
- FaceID opaque/incomplete 与 FaceID → IPAdapter fallback；
- framing retry；
- 默认 face→skirt 与可选 hair part refine；
- 连续 VAE 带来的接缝、色漂和细节劣化；
- 每阶段 prompt ID、耗时、fallback、mutator、资产版本与最终图片一致性。

出口：Registry/测试记录具备真实 Windows 证据。`registered` 不得冒充本次物理重算已通过。

### 6.2 Gate C：能力专用自动引用

- Qwen Fidelity/Multiangle 自动参考图注入；
- BiRefNet 自动源图注入；
- Florence2 自动源图注入；
- Registry/WorkflowBinding 定义能力专用引用角色与输入字段映射；
- 实际解析结果写入 ExecutionPlan。

出口：画布只提交产品语义，Gateway 可确定性解析；通用 `body_identity/style` 不冒充专项能力已完成。

### 6.3 Gate D/E：Pose

Gate D 先完成运行时探针和 FaceID × ControlNet 四格：

|  | ControlNet off | ControlNet on |
|---|---|---|
| FaceID off | baseline | pose-only |
| FaceID on | identity-only | 联合主路 |

每格记录模型/ControlNet/WorkflowBinding、姿势、身份、显存、耗时、错误码、回退和 runtime snapshot。禁止 SD1.5 ControlNet 静默用于 SDXL/Illustrious。

Gate E 再实现 PoseAsset、PoseRenderSpec、提取预览、单人姿势面板、共享 Pose Adapter、Exact Replay 与固定评测集。

### 6.4 Gate F：Character Atelier

- Gate A 固定角色或形成明确失败结论后重筛评测集。
- 继续 MaskAsset/EditPlan、Job、WorkflowBinding、保护 gate 和能力路由。
- Qwen Edit、BiRefNet、Florence2 只通过 CapabilityRegistry 使用。
- 换姿复用 Gate E，不建立 Atelier 私有 Pose 执行器。

### 6.5 Gate G：Story P0

- 创建模板只建链，生成任务数为 0。
- Story 只编译 GenerationIntent，不建立第二套 Prompt/Outpaint/Inpaint/Pose 执行器。
- Story 解绑不删除普通画布资产。
- 真实 Pose 镜头依赖 Gate E。

---

## 7. 里程碑与出口

| 里程碑 | 状态 | 目标 | 出口 |
|---|---|---|---|
| M0 契约冻结 | `DONE` | 统一类型、存储、API、能力模型 | 无平行类型，Shared Core 可复用 |
| M1 Outpaint 稳定性 | `IN_PROGRESS` | 五方向形成可用能力或明确失败清单 | Gate A 合法出口之一 |
| M2 能力注册与预检 | `DONE` | Capability、Workflow、资产、smoke、receipt 可追踪 | 工程验证完成；视觉编辑 smoke 属 Gate B |
| M3 自动引用 | `BLOCKED` | 专项能力消费画布引用 | Gate C 通过 |
| M4 Pose MVP | `BLOCKED` | 独立换姿真实闭环 | Gate D/E 通过 |
| M5 Character Atelier | `BLOCKED` | 固定角色后的拆解、保护和组合 | Gate F 通过 |
| M6 Story P0 | `BLOCKED` | 只建链和确定性编译 | Gate G 通过 |
| M7 发布物料 | `DEFERRED` | Ideogram、Upscale、Z-Image 质量实验 | Gate G 后另行激活；当前不得占用共享运行时或形成旁路证据 |
| M8 Pose P1 | `DEFERRED` | 骨架编辑器与人体 QA | Gate G 后另行激活 |
| M9 高级连续性 | `DEFERRED` | DensePose/SMPL/多人/视频 | Gate G 后再按许可证、性能和评测条件另行激活 |

---

## 8. 运行时能力摘要

| 能力 | 当前状态 | 近期缺口 |
|---|---|---|
| Shared Generation Core | `DONE` | C0-4 合入 PoC provenance/operation override；C0-5 已接 UI 消费；C0-6 合同落盘；C0-Z 约定验收已通过 |
| Capability U2-A/B/C | `DONE` | 保持契约，不重复开发 |
| Capability U2-E | `BLOCKED` | 工程已完成；Gate B Windows 真实编辑 UAT 受 Gate A 阻塞 |
| Qwen Edit / Florence2 / BiRefNet | Registry 已登记 | Gate C 自动引用 |
| OpenPose / DWPose | 候选与部分运行时在位 | Gate D 真实联合主路 |
| Ideogram 4 txt2img | `DONE` | 图生图适配后置 |
| Z-Image / Union ControlNet | 生成能力已登记 | Union Pose 未验证 |
| Character Atelier 评测集 | `BLOCKED` | 等 Gate E 完成并激活 Gate F；角色基线由 Gate A 合法出口提供 |

许可与维护边界：

- `cubiq/ComfyUI_IPAdapter_plus` 已归档且 maintenance-only，Gate D/E 前必须评估替代或固定版本。
- InsightFace `buffalo_l` 当前只允许本地研究/验证；商用或外部发布前必须取得授权或替换。

---

## 9. 证据与专项文档

| 内容 | 权威位置 |
|---|---|
| 总控状态、Gate、跨仓依赖 | 本文件 |
| 当前可执行任务 | `docs/content/docs/progress/todo.mdx` |
| Gate 0 / C0-1 输入快照 | `docs/gate-0-convergence-snapshot.md` |
| Gate 0 / C0-2 候选基线 | `docs/gate-0-c0-2-candidate-baseline.md` |
| Gate 0 / C0-3 证据合同候选 | `docs/gate-0-c0-3-candidate-baseline.md` |
| 已实现待人工验证 | `docs/content/docs/progress/pending-test.mdx` |
| Outpaint 实验产物 | `.uat/u1-outpaint/` |
| Illustrious PoC 细节 | PoC 工作树 `docs/illustrious-outpaint-poc.md`；Gate 0 后选择性合入 |
| Pose 设计与验收 | `docs/pose-control-development-plan.md` |
| Character Atelier | `docs/character-atelier-design.md`、`character-atelier-dev-checklist.md` |
| Story | `docs/story-workflow-prd.md` |
| 物理运行时 | Mission_manager Registry、Workflow 和测试记录 |

总控不再复制：每轮 prompt ID、A2→R9 参数流水账、模型下载调研、旧版本待验列表和审查对话过程。

---

## 10. 文档与审查规则

- 状态变化先更新本文件，再同步 TODO 或 pending-test。
- 计划工作只写 TODO；代码已完成但待人工验证才写 pending-test。
- BOSS 验收通过后再更新正式功能说明。
- 用户可感知变化写入 `CHANGELOG.md`；文档计划调整不得冒充产品功能已实现。
- 每完成 2–3 个开发阶段或一个完整 Batch，立即进行独立 review；先处理 Blocking/P0/P1，再继续后续阶段。
- review 不替代 BOSS 实图验收。
- 删除、提交、推送、合并工作树或修改共享外部状态前，必须取得 BOSS 明确确认。

---

## 11. 总交付定义

Infinite Canvas 最终是一套可独立使用的专业生成底座：用户可以单独生图、扩图、局部编辑、控制姿势、拆解角色和制作发布物料；Story 只在这些能力之上增加人物、场景、镜头和连续性编排。所有入口使用同一套意图、引用、执行计划、能力路由和质量证据，物理模型与工作流由 Mission_manager 管理。
