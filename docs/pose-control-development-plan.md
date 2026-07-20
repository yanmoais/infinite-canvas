# 人体骨骼与姿势控制开发计划 v0.2

> 状态：内审修订完成，可进入 Batch 1
> 所属能力：Shared Generation Core / Pose Foundation
> 总排期：`docs/infinite-canvas-unified-development-plan.md`
> 关联 PRD：`docs/story-workflow-prd.md` v0.5
> 执行原则：独立换姿先行，Story 与 Character Atelier 复用同一底座

---

## 0. 结论

Windows ComfyUI 已有 OpenPose/DWPose 和 SDXL Pose Control 候选，不需要把“继续下载模型”当作开工前置。

当前真正缺少的是完整应用闭环：

```text
运行时真相
→ PoseAsset
→ PoseRenderSpec
→ OperationProfile / ExecutionPlan
→ 共享 Pose Adapter
→ FaceID × ControlNet 联合主路
→ 固定评测
→ 独立换姿产品
```

P0 目标只做一件事：

> 普通图片节点在不创建 Story、不进入 Character Atelier 的情况下，使用真实 Pose Control 完成单人独立换姿，并能解释实际姿势、身份、模型、工作流、参数和降级。

P0 不要求：

- 完整骨架编辑器；
- 双人或复杂多人；
- DensePose/SMPL；
- 视频姿势连续；
- 自动人体总分；
- 精确服装物理保持；
- Story 镜头 UI。

---

## 1. 架构与依赖边界

### 1.1 所属层级

```text
独立换姿 ───────────────┐
Story Workflow ─────────┼──→ Pose Foundation ─→ Shared Core ─→ Pose Adapter
Character Atelier ──────┘                                      ↓
                                                        Mission_manager
                                                               ↓
                                                        Windows ComfyUI
```

Pose Foundation 拥有：

- PoseAsset；
- PoseRenderSpec；
- 姿势提取和预览；
- 结构化关键点；
- Pose Scaffold Preflight；
- Pose Control 执行计划；
- 模型家族和 validated pair；
- GeneratedHumanQA 契约。

上层只增加上下文：

- 独立换姿：姿势参考、身份参考、用户参数；
- Story：subject、shot、camera、framing、scene；
- Character Atelier：CharacterProfile、Outfit、保护区和观测失效。

### 1.2 强制禁止

- Story 类型成为 Pose 执行器必填参数；
- Character Atelier 另写 ControlNet 执行器；
- `pose_change: true` 冒充结构化姿势计划；
- FaceID 冒充姿势控制；
- SD1.5 ControlNet 静默用于 SDXL/Illustrious；
- 未验证的模型配对成为默认；
- 骨架 PNG 没有来源和 render spec 却宣称可编辑；
- OpenPose 预检被当作生成后人体通过证明；
- full_body Outpaint 偷偷调用 Pose 执行器；
- 在前端硬编码 Windows 物理模型路径；
- `twins` 未验证前标记为多人专用模型。

### 1.3 类型唯一权威

以下类型由 Shared Generation Core / Pose Foundation 定义一次：

- `PoseIntent`
- `PoseAsset`
- `PoseRenderSpec`
- `PoseControlSettings`
- `CompositionContext`
- `ReferenceBinding`
- `OperationProfile`
- `ExecutionPlan`

Story 与 Atelier 只能引用。

当前前端代码权威为 `web/src/types/generation.ts`。其中已定义 `PoseAsset`、`PoseRenderSpec`、`PoseControlSettings` 与 Gateway `PoseControlRequest` 最小 schema，并已实现图片首次写入 revision/hash、替换后递增和一跳下游 `stale` 标记。Mission_manager Gateway 已完成最小接收校验：无效契约明确返回 `invalid_pose_control`，有效契约在 WorkflowBinding 尚未连接时明确返回 `pose_control_not_ready`。通用 `GET /api/v1/capabilities`、普通画布生图/重试主路径 Runtime Preflight 和提交前 Shared ExecutionPlan 已落地；Exact Replay 会保留旧 binding/hash 后再叠加当前 gate。Pose 专用 capability、操作级 WorkflowBinding/资产 gate、Pose/Identity 双引用和 ControlNet 执行仍属于后续批次，不能把通用能力 gate 完成标记成换姿闭环完成。

---

## 2. 运行时基线与证据边界

### 2.1 已知 Windows 基线

| 项目 | 记录值 |
|---|---|
| ComfyUI 主机 | `192.168.2.157:8188` |
| GPU | NVIDIA GeForce RTX 5060 Ti 16GB |
| 预处理候选 | `OpenposePreprocessor`、`DWPreprocessor` |
| Loader | `ControlNetLoader` |
| SDXL 默认候选运行时名 | `controlnet-openpose-sdxl-1.0\diffusion_pytorch_model.safetensors` |
| 记录大小 | `2,502,139,104 bytes` |
| 记录 SHA256 | `B8524E557A7DF60D081F5D4A0EB109967D107DF217943BF88C2D99B9EBCC06C5` |

其他运行时记录：

```text
controlnet-openpose-sdxl-1.0\diffusion_pytorch_model_twins.safetensors
controlnetxlCNXL_2vxpswa7OpenposeV21.safetensors
control_v11p_sd15_openpose.pth
```

`control_v11p_sd15_openpose.pth` 只允许用于 SD1.5。

### 2.2 必须重新验证

以上是历史运行时证据，不等于当前时刻仍然可用。Batch 1 必须重新验证：

1. 文件存在；
2. 文件哈希；
3. Loader 枚举；
4. detector/preprocessor 节点；
5. Apply ControlNet 节点和字段；
6. workflow 字段兼容；
7. 最小 smoke；
8. 底模 × ControlNet × FaceID 联合主路。

### 2.3 模型身份与配对

CapabilityRegistry 不只保存 `family: "sdxl"`，还要保存：

```ts
type PoseModelCapability = {
  capabilityId: string;
  runtimeModelId: string;
  publisher: string;
  sourceRepo: string;
  sha256: string;
  architecture: string;
  baseModelId?: string;
  validatedPairs: Array<{
    baseModelId: string;
    workflowBindingId: string;
    status: "candidate" | "validated" | "rejected";
  }>;
  status: "candidate" | "validated" | "rejected" | "unverified_candidate";
};
```

要求：

- Batch 1 核对默认候选的 publisher/source；
- Illustrious/NoobAI 等底模使用 `validatedPairs` 区分；
- `twins` 先标 `unverified_candidate`；
- Z-Image Union ControlNet 当前只能作为通用/Canny 候选，不标为已验证 Pose；
- 模型家族由 Gateway capability 返回，前端不靠文件名猜测。

---

## 3. 领域模型

### 3.1 操作类型

```ts
type CanvasOperationKind =
  | "manual"
  | "inpaint"
  | "outpaint"
  | "pose_change"
  | "character_atelier"
  | "layout_generation"
  | "exact_replay";
```

图片生成、图片编辑和视频生成由独立 `MediaGenerationType` 表达，不进入此枚举。

### 3.2 PoseAsset

```ts
type PoseKeypointFormat =
  | "openpose_body_18"
  | "openpose_body_25"
  | "coco_wholebody_133"
  | "custom";

type PoseAssetMode = "structured" | "render_only";

type PoseAsset = {
  id: string;
  schemaVersion: "1";
  revision: number;
  contentHash: string;
  mode: PoseAssetMode;
  format: PoseKeypointFormat;
  source: "detected" | "uploaded" | "editor" | "template";
  sourceNodeId?: string;
  detector?: "openpose" | "dwpose";
  width: number;
  height: number;
  persons: PosePerson[];
  renderSpec: PoseRenderSpec;
  renderedStorageKey: string;
  createdAt: string;
  updatedAt: string;
};
```

格式不得只靠数组长度猜测。关键点访问必须按名称映射。

### 3.3 PoseRenderSpec

```ts
type PoseRenderSpec = {
  schemaVersion: "1";
  colorSchema: "openpose_standard" | "dwpose_standard" | "custom";
  background: "black" | "transparent";
  canvasWidth: number;
  canvasHeight: number;
  lineWidth: number;
  pointRadius: number;
  includeBody: boolean;
  includeHands: boolean;
  includeFace: boolean;
};
```

条件图契约必须固定：

- 画布尺寸；
- 黑底或透明底；
- body/hand/face 开关；
- 线宽与点半径；
- 标准配色；
- 是否按原图坐标或归一化坐标渲染。

编辑器渲染与 detector 输出必须使用同一语义，避免条件图分布不一致。

### 3.4 PoseControlSettings

```ts
type PoseControlSettings = {
  poseAssetId: string;
  poseAssetRevision: number;
  poseAssetContentHash: string;
  preprocessor: "openpose" | "dwpose" | "none";
  controlCapabilityId: string;
  modelFamily: "sd15" | "sdxl" | "flux" | "qwen_image";
  baseModelId: string;
  strength: number;
  startPercent: number;
  endPercent: number;
  controlMode: "body" | "body_hands" | "whole_body";
  maxPersons: 1;
};
```

物理 ControlNet 文件名只出现在 ExecutionPlan 的 runtime snapshot，不写入产品设置。

### 3.5 PoseAsset 权威存储

P0：

- 浏览器 `localforage` 是可编辑 PoseAsset 的权威存储；
- 骨架预览图片继续走 storage key；
- Gateway 不根据 `poseAssetId` 反查浏览器；
- 执行请求发送 PoseAsset 快照、条件图或临时资产；
- Gateway 只记录本次快照、哈希和实际运行时；
- ExecutionPlan 保存 `id + revision + contentHash`；
- 缺 PoseAsset 时 Exact Replay 明确失败。

`render_only → structured`：

- 保留同一 `poseAssetId`；
- revision 增加；
- contentHash 改变；
- 旧下游标记 stale；
- 不伪造空关键点。

### 3.6 节点元数据

```ts
type PoseGenerationMetadata = {
  poseAssetId: string;
  poseAssetRevision: number;
  poseAssetContentHash: string;
  poseControl: PoseControlSettings;
  poseReferenceNodeId?: string;
  identityReferenceNodeId?: string;
  poseRenderSpec: PoseRenderSpec;
  preflightStatus?: "not_run" | "pass" | "warning" | "reject";
  generatedHumanQa?: {
    status: "not_run" | "pass" | "warning" | "reject";
    reasons: string[];
  };
};
```

---

## 4. API 与运行时契约

### 4.1 API 统一

```text
GET  /api/v1/capabilities
GET  /api/v1/pose/capabilities
POST /api/v1/pose/extract
POST /api/v1/pose/preview
POST /api/v1/jobs
GET  /api/v1/jobs/{jobId}
POST /api/v1/jobs/{jobId}/cancel
```

不继续新增 `/nannan/pose-*`。

### 4.2 Pose capabilities

```json
{
  "available": true,
  "detectors": [
    {
      "id": "dwpose",
      "formats": ["coco_wholebody_133"],
      "supportsStructuredOutput": false,
      "supportsBody": true,
      "supportsHands": true,
      "supportsFace": true
    }
  ],
  "applyNodes": [
    {
      "id": "ControlNetApplyAdvanced",
      "fields": ["strength", "start_percent", "end_percent"]
    }
  ],
  "capabilities": [
    {
      "capabilityId": "pose.control.sdxl.candidate",
      "architecture": "sdxl_controlnet",
      "supportedBaseModelIds": [],
      "status": "candidate"
    }
  ]
}
```

探针必须返回：

- detector；
- 输出格式；
- structured/render-only 能力；
- Loader；
- Apply 节点变体；
- 实际字段名；
- 模型架构；
- validated pair；
- workflow binding；
- 缺失项和原因。

### 4.3 extract

输入：

- 图片或资产引用；
- detector；
- body/hand/face；
- 输出尺寸；
- `maxPersons=1`。

输出：

- PoseAsset 草稿；
- rendered skeleton；
- mode；
- format；
- person count；
- warnings；
- runtime snapshot。

### 4.4 preview

preview 用于：

- 将 structured keypoints 渲染为条件图；
- 验证 PoseRenderSpec；
- 在生成前向用户展示最终条件；
- 不触发正式图片生成。

### 4.5 生成请求

```ts
type ComfyPoseControlConfig = {
  enabled: true;
  pose_asset_snapshot: PoseAsset;
  condition_image_storage_key?: string;
  control_capability_id: string;
  control_strength: number;
  control_start: number;
  control_end: number;
  control_mode: "body" | "body_hands" | "whole_body";
};
```

跨仓联调顺序：

1. Gateway 先能接收并校验 `pose_control`；
2. 前端完成序列化和 ExecutionPlan；
3. Gateway 再接真实 WorkflowBinding；
4. 最后移除生产路径中的旧 `pose_change` 假换姿。

---

## 5. P0 开发批次

### Batch 1：运行时探针与联合冒烟

目标：证明“生产组合”可用，而不只是节点和文件存在。

任务：

- 重新枚举 OpenPose/DWPose；
- 枚举 ControlNet Loader；
- 枚举 Apply 节点和字段；
- 核对默认候选 publisher/source/hash；
- 建立稳定 WorkflowBinding 和 hash；
- 在 Gateway 提交前消费 `validatedPairs`，按 `baseModelId × ControlNet capability/workflowBindingId` 做硬校验；未验证组合不进入生产默认，SD1.5 ControlNet × SDXL/Illustrious 直接阻断；
- 固定单人站姿、坐姿；
- 固定 checkpoint、prompt、seed、分辨率；
- 记录显存峰值、耗时和错误；
- 完成 FaceID × ControlNet 四格矩阵。

四格：

| | ControlNet off | ControlNet on |
|---|---|---|
| FaceID off | baseline | pose-only |
| FaceID on（生产默认权重） | identity-only | 联合生产主路 |

每格必须记录：`baseModelId`、`controlNetCapabilityId`、`workflowBindingId`、身份/姿势结果、`vramPeakMb`、`durationMs`、错误码、失败回退动作和 runtime snapshot。

验收：

- ControlNet on/off 有可辨识姿势差异；
- 联合主路保持身份且不明显拉回旧姿势；
- 人物数量不增加；
- 禁止 SD1.5 路径；
- Runtime Preflight 能识别缺失模型、节点和字段；
- `twins` 仍为 `unverified_candidate`；
- 得出 structured 或 render-only 的真实结论。

预计：2–3 个开发日。

### Batch 2：PoseAsset、存储与执行计划

目标：

- 定义 PoseAsset / PosePerson / PoseKeypoint；
- 定义 PoseRenderSpec；
- localforage 存储；
- storage key 保存预览图；
- OperationProfile 增加 Pose 引用；
- ExecutionPlan 保存 Pose/Identity 的独立来源；
- P0 stale 只标记直接下游；
- Exact Replay 缺资产明确失败；
- 孤儿 PoseAsset 和预览图具备清理入口。

验收：

- 无 Story ID 可创建和复用；
- 同一 PoseAsset 被多个节点引用；
- revision/hash 变化使直接下游 stale；
- 节点可查看最终能力、参数、来源和 runtime snapshot。

预计：2–3 个开发日。

### Batch 3：提取、预览与最小姿势面板

P0 UI：

- 选择姿势参考；
- 选择 DWPose/OpenPose；
- body/hand/face；
- 显示骨架预览；
- 显示人物数量；
- 选择身份参考；
- strength/start/end；
- 显示模型家族、capability 和 warnings；
- 保存 PoseAsset；
- 执行独立换姿。

信息密度：

- 默认显示姿势参考、身份参考、预览和主强度；
- 模型家族、实际 capability、start/end 和 warnings 细节进入折叠区；
- 不使用长期占据画布的大面板；
- 使用现有主题 token。

验收：

- 普通图片节点直接进入；
- 不创建 Story；
- 姿势和身份可选不同节点；
- 面板关闭后资产不丢失；
- 只返回 render-only 时明确禁用关节编辑。

预计：3–4 个开发日。

### Batch 4：共享 Pose 执行器

目标：

- 新 `pose_control` 请求成为真相源；
- Pose Adapter 根据 capability 选 WorkflowBinding；
- FaceID、Pose、Outfit、prompt 分开；
- 单 GPU 队列与 Atelier 共用；
- OOM 返回统一错误码；
- 实际 fallback 回写 ExecutionPlan；
- 重试固定 PoseAsset revision；
- `project.tsx` 旧内联 pose-change 生产分支迁出或下岗；
- 不在组件里动态拼 ComfyUI 节点。

验收：

- 独立换姿真实闭环；
- 新旧生产逻辑不并存；
- 普通生图、Outpaint、Inpaint 不被强制增加 Pose；
- full_body Outpaint 不调用 Pose Adapter；
- 缺 capability 时不静默裸跑。

预计：3–5 个开发日。

### Batch 5：固定评测与默认参数

姿势几何集与角色身份集分离：

- 几何集不等待角色定妆，可使用公开或合成骨架；
- 身份集在 Outpaint 固定角色后并入；
- 复用 Atelier 的 CCIP、wd14、sdeval 工装。

最低固定集：

- 正面站立；
- 三分之四站立；
- 简单坐姿；
- 背身；
- 手臂交叉；
- 手靠近脸；
- 低机位全身；
- 脚朝相机的透视缩短；
- 桌后半遮挡坐姿；
- 动漫和写实。

评价：

- 人物数量；
- 姿势服从；
- 身体完整；
- 关节方向；
- 手脚；
- 裁切；
- 接地；
- FaceID；
- 发型与服装漂移；
- 画风；
- 显存和耗时。

姿势匹配：

```text
使用同一 detector 和 schema 对输出重新检测
→ OKS 或 mean normalized joint L2
→ 阈值在固定集校准后再启用
```

未校准前，指标只记录，不作为唯一阻断。

CapabilityRegistry 默认值必须来自固定评测，并保存失败案例。

预计：2–3 个开发日。

### Batch 6：Pose MVP 收口

验收：

- 文档、API、类型和实际字段一致；
- capability 默认有证据；
- 错误和降级文案完整；
- Exact Replay 可复现；
- P0 fixed set 可重复；
- BOSS 完成实图验收；
- 完成项移到 `pending-test.mdx`，不直接写正式功能说明。

MVP = Batch 1–6。

---

## 6. P1 开发批次

### Batch 7A：骨架编辑器第一阶段

能力：

- 关节点拖拽；
- 整人平移、缩放、旋转；
- 左右镜像；
- 原图半透明叠加；
- body/hand/face 分层；
- 撤销/重做；
- 重新渲染；
- revision/stale。

不做约束求解。

预计：5–8 个开发日。

### Batch 7B：骨架编辑器第二阶段

能力：

- 锁骨长；
- 对称约束；
- 地面线；
- 脚部吸附；
- 安全区；
- 边界情况处理；
- 零骨长、重合关键点、缺失关节测试。

预计：3–7 个开发日。

骨架编辑器总估算：8–15 个开发日。

### Batch 7C：Pose Scaffold Preflight

确定性检查：

- 缺少必要关节；
- 低置信度；
- 越界；
- 左右疑似交换；
- 骨长异常；
- 关节角异常；
- 脚低于地面；
- 人物数超过 P0；
- 身份绑定歧义。

只输出 warning/reject，不宣称医学正确。

### Batch 7D：GeneratedHumanQA

第一阶段人工 UI：

- 人物数量；
- 肢体完整；
- 手脚；
- 关节；
- 穿模；
- 接地；
- 裁切；
- 身份和服装漂移。

自动模型后续接入，未校准前不作为唯一阻断。

---

## 7. 上层接入顺序

### Batch 8A：Story 最小接入

前置：Pose MVP。

Story 只编译：

- subjectId；
- shotId；
- PoseIntent；
- camera/framing；
- scene；
- ReferenceBinding。

最终调用同一 Pose OperationProfile 和 Adapter。

Story 接入不等待 Character Atelier P0B。

### Batch 8B：Character Atelier 接入

前置：

- Pose MVP；
- `character-atelier-dev-checklist.md` 的 P0B 必要项；
- RegionObservation 失效协议；
- 保护区和 Job 能力。

Atelier 增加：

- CharacterProfile；
- outfit reference；
- body constraints；
- 换姿后旧 RegionObservation 作废；
- 重新分割。

不得复制 Pose Adapter。

---

## 8. P2 高级能力

### Batch 9 候选

- DensePose；
- Depth 辅助前后关系；
- SMPL/3D 人体；
- 强透视与复杂缩短；
- 多人物区域身份绑定；
- 手部局部 ControlNet；
- 视频姿势关键帧和插值；
- 跨镜头人物尺度与光源检查。

进入条件：

- Pose MVP 稳定；
- P1 编辑器和 QA 通过；
- 固定评测可重复；
- 许可证完成审查；
- 16GB 显存预算可接受；
- 不影响当前生产主路。

SMPL、DensePose 和社区模型必须单列许可证 gate。
当前联合主路使用的 InsightFace `buffalo_l` 预训练模型仅允许 non-commercial research use；Pose P0 的 FaceID × ControlNet 四格只属于本地研究/验证证据。进入商用或对外发布前必须取得 InsightFace 授权或替换身份模型。

---

## 9. P0 总验收

### 9.1 独立性

- [ ] 普通图片节点直接进入姿势控制；
- [ ] 无 Story/Atelier 可完成全流程；
- [ ] 普通生图、Outpaint、Inpaint 未增加 Pose 必填；
- [ ] full_body Outpaint 不调用 Pose Adapter。

### 9.2 运行时

- [ ] detector、Loader、Apply 节点运行时可见；
- [ ] 模型 hash/publisher/source 可查；
- [ ] WorkflowBinding 稳定；
- [ ] SD1.5/SDXL 错配阻断；
- [ ] Runtime Preflight 覆盖文件、节点、字段和 smoke；
- [ ] `twins` 不被误标为已验证多人模型。

### 9.3 数据

- [ ] PoseAsset 有 mode/format/revision/hash；
- [ ] PoseRenderSpec 完整；
- [ ] localforage 是 P0 权威存储；
- [ ] Gateway 只保存执行快照；
- [ ] render-only 不伪造关键点；
- [ ] Exact Replay 缺资产明确失败；
- [ ] 孤儿资产有清理入口。

### 9.4 联合生成

- [ ] FaceID × ControlNet 四格完成；
- [ ] 四格均保存 baseModel/ControlNet 配对、显存预算、耗时、失败回退和 runtime snapshot；
- [ ] Gateway 已消费 `validatedPairs`，未验证架构配对无法提交；
- [ ] 联合主路通过；
- [ ] Identity/Pose/Outfit/prompt 来源分开；
- [ ] 单人基础姿势达到固定集门；
- [ ] 服装保持标记 best-effort；
- [ ] 失败保存参数、原因和 runtime snapshot。

### 9.5 UI

- [ ] 姿势和身份参考分开选择；
- [ ] 骨架条件可预览；
- [ ] 人物数量和 warning 可见；
- [ ] 详细模型参数默认折叠；
- [ ] UI 使用当前画布主题；
- [ ] render-only 不显示虚假编辑能力。

---

## 10. 测试计划

### 10.1 单元测试

```text
web/tests/pose-asset.test.ts
web/tests/pose-render-spec.test.ts
web/tests/pose-generation-plan.test.ts
web/tests/pose-capability-routing.test.ts
```

覆盖：

- schema；
- keypoint 名称映射；
- family guard；
- validated pair；
- revision/hash/stale；
- ExecutionPlan 来源；
- Exact Replay 缺资产；
- render-only 升级；
- maxPersons；
- orphan cleanup。

### 10.2 契约测试

- `/api/v1/pose/capabilities`；
- detector/Apply 字段；
- extract；
- preview；
- `pose_control` 请求；
- missing runtime；
- wrong family；
- OOM；
- cancel；
- runtime snapshot。

### 10.3 集成测试

- ControlNet workflow 提交；
- FaceID + ControlNet；
- 重试；
- ComfyUI 下线；
- 模型删除；
- 节点缺失；
- workflow hash 变化；
- Gateway 只接收不执行阶段的 schema 联调。

### 10.4 人工实图

以 Batch 5 固定集为准，结果同时检查姿势、身份、服装、人体、构图、接地、显存和耗时。

---

## 11. 风险与处理

| 风险 | 处理 |
|---|---|
| detector 只输出骨架图 | 先走 render-only，编辑器后置 |
| 通用 SDXL ControlNet 在 Illustrious 不稳定 | validatedPairs + 固定 A/B；失败再加专用候选 |
| FaceID 拉回旧姿势 | 四格矩阵、降低身份作用域、分阶段生成 |
| FaceID 预训练模型不可商用 | Registry 显式 `commercialUse=restricted`；本地验证与商用发布分门，授权或替换前不得进入对外主路 |
| IPAdapter 插件已归档 | 固定已验证 `ComfyUI_IPAdapter_plus` 版本/节点签名；U3/U4 记录替代实现和迁移回退 |
| 服装漂移 | P0 best-effort；后续 Outfit reference/局部修复 |
| 2D 骨架无法表达接地和强透视 | 固定集加入低机位、脚朝相机和遮挡；P2 再引入深度/3D |
| 多人串位 | P0 `maxPersons=1` |
| 16GB 显存 OOM | 与 Atelier 共用单 GPU 队列和错误码 |
| API 双轨 | 只新增 `/api/v1/*` |
| 组件继续堆逻辑 | Pose Adapter 与请求编译抽离，旧内联分支下岗 |
| 模型物理名污染领域 | 产品层只使用 capability ID |
| stale 传播过度设计 | P0 只做直接下游 |

---

## 12. 开工清单

Batch 1 现在可以开始，但必须按以下顺序：

1. `/api/v1/pose/capabilities` schema；
2. 运行时 detector/Loader/Apply 探针；
3. 默认候选 publisher/source/hash 核对；
4. WorkflowBinding；
5. 结构化关键点 Spike；
6. FaceID × ControlNet 四格；
7. 明确 structured/render-only；
8. 再进入 PoseAsset 和 UI。

在联合主路通过以前：

- 不开始完整编辑器；
- 不开始 DensePose/SMPL；
- 不宣称换姿闭环完成；
- 不让 Story 或 Atelier 建第二条姿势链；
- 不将未校准参数显示为生产默认。
