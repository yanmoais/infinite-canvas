# 故事工作流（Story Workflow）PRD v0.5

> 状态：内审修订版
> 产品定位：在独立生成底座之上提供可选的故事可视化编排
> 总开发计划：`docs/infinite-canvas-unified-development-plan.md`
> 姿势计划：`docs/pose-control-development-plan.md`
> 角色设计：`docs/character-atelier-design.md`

---

## 0. 产品结论

### 0.1 Story 不接管基础能力

Infinite Canvas 的生图、扩图、局部编辑、换姿、场景修改、提示词组合器、Character Atelier 和发布物料生成必须保持各自独立。

```text
独立生图 / Inpaint / Outpaint / Pose / Atelier / Story
                              ↓
                    Shared Generation Core
                              ↓
                OperationProfile + ExecutionPlan
                              ↓
                  Provider / Workflow Adapter
                              ↓
                Mission_manager / ComfyUI / API
```

Story Workflow 只负责：

- 故事、人物、场景、节拍和镜头；
- 跨镜头的人物、服装、道具、空间和光源连续性；
- 镜头的叙事目的与覆盖关系；
- 把 Story 语义编译为共享 `GenerationIntent`；
- 组织生成顺序、版本和质量检查；
- 在用户确认后调用共享执行器。

Story Workflow 不拥有：

- 第二套 PromptCompiler；
- 第二套 Outpaint / Inpaint / Pose 执行器；
- ComfyUI 模型文件名和节点参数；
- Character Atelier 的部件库；
- 独立工具的必填参数；
- 生成结果的唯一生命周期。

### 0.2 五条架构不变式

1. **基础能力可独立运行**
   没有 `storyId`、`sceneId`、`shotId` 时，基础操作仍须完整可用。

2. **依赖单向**
   `Story → StoryGenerationAdapter → Shared Generation Core`。Shared Core 禁止导入 Story 类型。

3. **同一能力只有一套执行链**
   Story 内扩图与独立扩图使用同一个 OperationProfile、ExecutionPlan 和 Adapter。

4. **Story 上下文只做增强**
   Story 可以增加连续性和镜头意图，但不能让基础能力新增 Story 必填字段。

5. **结果可脱离 Story**
   删除 Story 绑定不得删除普通图片、视频和素材，也不得阻止后续独立编辑。

### 0.3 类型权威

以下类型唯一权威位于 Shared Generation Core：

- `CompositionContext`
- `PoseIntent`
- `CameraIntent`
- `SceneIntent`
- `ReferenceBinding`
- `PoseAsset`
- `OperationProfile`
- `ExecutionPlan`

Story 只定义 Story 专属实体和 `StoryGenerationAdapter`，不得复制同名类型。

当前前端代码权威为 `web/src/types/generation.ts`；Story 后续只能导入这些类型或提交 `Partial` 覆盖。类型化提示词编译入口为 `web/src/lib/canvas/prompt-compiler.ts`，Story 不新增第二套 PromptCompiler。Shared Core 已支持基于 `revision/contentHash` 的一跳下游 `stale` 传播，Mission_manager 也已具备 `pose_control` 最小接收校验；Story 多层依赖传播仍留在 Story 里程碑实现，真实姿势执行仍等待 Pose WorkflowBinding，不反向塞进基础画布。

---

## 1. 背景与问题

### 1.1 当前基础

项目已经具备：

- 无限画布节点、连接、分组和生成入口；
- 独立图片生成、图片编辑、Outpaint 和 Inpaint；
- FaceID/IPAdapter 身份参考；
- 提示词组合、冲突处理和智能排序；
- OperationProfile / ExecutionPlan 初步实现；
- Character Atelier 的角色、部件和保护设计；
- Windows ComfyUI 的 OpenPose/DWPose、ControlNet、分割、打标和编辑能力；
- Z-Image、Ideogram、Qwen Edit、Florence2、BiRefNet、Upscale 等运行时能力池。

### 1.2 当前缺口

- 不同入口可能各自解释构图、镜头、光源和姿势；
- 参考图无法可靠表达锁脸、锁衣服、控姿势、控布局和控风格的区别；
- 现有“换姿”仍需要真实 Pose Control 闭环；
- 扩图存在人物边缘、头发、透视和光源连续性风险；
- Story 缺少稳定实体、继承规则、版本和 stale；
- 场景缺少空间轴线、人物站位、视线、尺度和光源锚点；
- 分镜缺少叙事目的和覆盖关系；
- 自动质量分未校准，无法代替人工判断；
- 物理模型和产品领域存在被直接耦合的风险。

### 1.3 产品原则

Story 是“可保存、可重编译的高级编排”，不是基础工具的前置条件。

用户可以先独立生成和修改图片，再将结果绑定到 Story；也可以从 Story 创建镜头后调用同一套生成底座。

---

## 2. 产品目标与非目标

### 2.1 目标

#### G1. 独立工具不被 Story 强绑定

用户无需创建故事即可：

- 生图；
- 局部编辑；
- 五方向扩图；
- 修改人物姿势；
- 修改场景；
- 使用摄影指导；
- 使用提示词组合器；
- 进入 Character Atelier；
- 查看执行计划和质量结果。

#### G2. 建立共享专业指导

构图、摄影、光影、场景延伸和人体姿势属于 Shared Generation Core，所有生成入口都能使用。

#### G3. 建立 Story 连续性

Story 能保存：

- 人物身份和状态；
- 服装与道具状态；
- 场景空间；
- 镜头轴线与视线；
- 角色相对尺度和景深位置；
- 光源方向、色温和时段；
- 每个镜头的叙事目的。

#### G4. 可解释、可降级、可回放

每次生成都可查看：

- 最终提示词块；
- 字段来源；
- 参考图角色和权重；
- 实际能力与降级；
- OperationProfile；
- ExecutionPlan；
- workflow/model runtime snapshot；
- stale 状态；
- QualityCheckResult。

#### G5. 先建链，后生成

Story P0 创建模板时默认生成任务数为 0。用户确认镜头和继承关系后才执行生成。

### 2.2 非目标

v0.5 不承诺：

- 自动生成完整成片；
- 替代剪辑软件；
- 精确三维灯光仿真；
- 单靠 OpenPose 证明人体正确；
- 单靠提示词完成精确换姿；
- 多人复杂遮挡和区域身份绑定；
- DensePose/SMPL 主路；
- 视频逐帧姿势控制；
- 云同步；
- 在 PRD 中写死模型文件和 ComfyUI 节点；
- 对未经评测的模型配对承诺可用。

---

## 3. 用户与核心场景

### 3.1 独立场景

| 场景 | 用户动作 | Story 是否必需 |
|---|---|---|
| 独立生图 | 输入提示词、构图、相机、光源和参考图 | 否 |
| Outpaint | 选择方向、扩展规模和连续性保护 | 否 |
| Inpaint | 绘制蒙版、指定编辑目标和保护区 | 否 |
| Pose | 选择姿势与身份参考，执行独立换姿 | 否 |
| Atelier | 拆解、替换、组合角色部件 | 否 |
| 发布物料 | 使用文字、排版和放大能力 | 否 |

### 3.2 Story 场景

#### S1. 从创意创建故事骨架

用户输入：

- 创意或剧本；
- 人物数量；
- 场景数量；
- 镜头数量或节拍密度；
- 画幅和视觉风格。

系统预览将创建的结构，用户确认后只建节点和连接。

#### S2. 创建镜头关键帧

用户选中 Shot，系统展示：

- 人物与场景继承；
- 构图、相机、光源和姿势；
- ReferenceBinding；
- 能力和降级；
- 最终 ExecutionPlan。

用户确认后调用共享图片生成或编辑能力。

#### S3. 修改上游后重编译

人物、场景或镜头变化后：

- 相关下游标记 `stale`；
- 旧结果保留；
- 用户可重新编译、继续使用旧结果或解除绑定。

#### S4. 资产退出故事

Story 中的图片、视频和 PoseAsset 可解除绑定，继续作为普通画布资产使用。

---

## 4. 总体架构

### 4.1 产品入口

```text
Product Entrypoints
├─ Manual Image Generation
├─ Inpaint
├─ Outpaint
├─ Pose Control
├─ Character Atelier
├─ Story Workflow
└─ Publishing Assets
        ↓
Shared Generation Core
├─ GenerationIntent
├─ CompositionContext
├─ ReferenceBinding
├─ PromptCompiler
├─ OperationProfile
├─ ExecutionPlan
├─ CapabilityRegistry
└─ QualityGate
        ↓
Provider / Workflow Adapter
        ↓
Mission_manager Registry / Runtime
```

### 4.2 操作类型

```ts
type CanvasOperationKind =
  | "manual"
  | "inpaint"
  | "outpaint"
  | "pose_change"
  | "character_atelier"
  | "layout_generation"
  | "exact_replay";

type MediaGenerationType =
  | "image_generation"
  | "image_edit"
  | "video_generation"
  | "audio_generation";
```

两者分别表示“由什么托管操作发起”和“执行哪种媒体任务”，不得混成一个枚举。

### 4.3 入口职责

| 入口 | 自己拥有 | 复用共享底座 | 禁止拥有 |
|---|---|---|---|
| 独立生图 | 用户输入和局部 UI | Composition、PromptCompiler、ExecutionPlan | Story 实体 |
| Outpaint | 方向、画幅、源图几何、蒙版 | 连续性计划、质量检查 | Story 场景模型 |
| Inpaint | 蒙版、目标、保护区 | ReferenceBinding、EditPlan | Story 镜头模型 |
| Pose | 姿势来源、参数、身份源 | PoseAsset、Pose Adapter、人体 QA | Story 剧情 |
| Atelier | 角色、部件、配方和保护 | Shared Core、Pose Foundation | 物理模型文件 |
| Story | 故事、人物、场景、镜头和连续性 | 全部共享能力 | 第二套执行器 |

---

## 5. Shared Generation Core

### 5.1 GenerationIntent

```ts
type GenerationIntent = {
  schemaVersion: "1";
  mediaType: MediaGenerationType;
  operation: CanvasOperationKind;

  userPrompt?: string;
  negativePrompt?: string;
  composition?: CompositionContext;
  references?: ReferenceBinding[];
  protections?: ProtectionRule[];
  requestedQualityGates?: string[];

  contextTrace?: {
    storyId?: string;
    sceneId?: string;
    shotId?: string;
    characterId?: string;
  };
};
```

要求：

- `contextTrace` 全部可选；
- Story 信息先经过 Adapter；
- 不支持字段显式返回 `degraded/not_supported`；
- 不将模型文件、工作流 JSON 或物理路径写入产品意图。

### 5.2 CompositionContext

```ts
type CompositionContext = {
  pose?: PoseIntent;
  camera?: CameraIntent;
  scene?: SceneIntent;
  framing?: FramingIntent;
  lighting?: LightingIntent;
};
```

Story 只提交：

```ts
type StoryCompositionOverrides = {
  pose?: Partial<PoseIntent>;
  camera?: Partial<CameraIntent>;
  scene?: Partial<SceneIntent>;
  framing?: Partial<FramingIntent>;
  lighting?: Partial<LightingIntent>;
};
```

### 5.3 ReferenceBinding

```ts
type ReferenceBinding = {
  bindingId: string;
  nodeId: string;
  role:
    | "face_identity"
    | "body_identity"
    | "hairstyle"
    | "outfit"
    | "pose"
    | "depth"
    | "layout"
    | "scene"
    | "style"
    | "lighting"
    | "first_frame"
    | "last_frame";
  subjectId?: string;
  strength?: number;
  revision?: number;
  contentHash?: string;
  regionMaskNodeId?: string;
  required?: boolean;
  scope?: "operation" | "character" | "scene" | "shot" | "story";
};
```

规则：

- 身份、服装、姿势、场景和风格分开绑定；
- Adapter 决定真实参数映射；
- 模型不支持某角色时显式降级；
- 旧 `references: string[]` 直接替换，不保留兼容层；
- 引用 revision/hash 变化后直接下游计划 stale。

### 5.4 PromptCompiler

类型化编译顺序：

```text
保护与安全约束
→ 主体与身份
→ 动作与姿势
→ 构图与景别
→ 相机
→ 场景与空间关系
→ 光影与色彩
→ 风格与媒介
→ 操作专属指令
→ 用户明确覆盖
→ 负面约束
```

新增 `prompt-compiler.ts` 适配层：

- 负责类型化意图到文本块；
- 内部复用 `smart-compose-prompt.ts` 的自由文本、词序和冲突能力；
- 不直接大改现有组合器对外签名；
- 输出保留来源、警告和冲突决策。

### 5.5 OperationProfile 与 ExecutionPlan

OperationProfile 托管工程默认值；ExecutionPlan 保存不可变快照。

```ts
type ExecutionPlan = {
  planId: string;
  schemaVersion: "1";
  operation: CanvasOperationKind;
  mediaType: MediaGenerationType;
  compiledPrompt: CompiledPrompt;
  resolvedReferences: ReferenceBinding[];
  values: Record<string, {
    value: unknown;
    source: GenerationValueSource;
    sourceNodeId?: string;
    sourceRevision?: number;
  }>;
  capabilityDecisions: CapabilityDecision[];
  compiledFromHash: string;
  dependencyState: "fresh" | "stale" | "missing_reference" | "compile_error";
};
```

覆盖优先级：

```text
user_override
> shot_override
> scene_context
> character_context
> creative_spec
> source_recipe
> operation_profile
> preset_default
```

P0 只保证直接下游 stale，不提前实现全图级递归传播。

### 5.6 CapabilityRegistry

Story 只消费能力 ID，不读取模型文件名。

共享能力至少包含：

- ModelCapability；
- WorkflowBinding；
- RuntimeAssetRequirement；
- QualityTier；
- IdentityPolicy；
- CompositionPolicy；
- SafetyMode；
- FallbackPolicy。

能力检查必须区分：

```text
supported
degraded
not_supported
missing_runtime
unverified_pair
```

---

## 6. 专业生成指导层

专业指导属于 Shared Generation Core，而不是 Story 专属功能。

### 6.1 构图

```ts
type FramingIntent = {
  shotSize?:
    | "extreme_close_up"
    | "close_up"
    | "medium_close_up"
    | "medium"
    | "medium_full"
    | "full"
    | "wide";
  subjectPlacement?: "center" | "left_third" | "right_third" | "symmetry";
  headroom?: "tight" | "normal" | "open";
  leadRoom?: "left" | "right" | "none";
  safeArea?: {
    protectHead?: boolean;
    protectHands?: boolean;
    protectFeet?: boolean;
  };
  forbidCrop?: Array<"head" | "face" | "hands" | "feet" | "prop">;
};
```

构图指导需要检查：

- 主体是否落在视觉重心；
- 头顶空间是否合理；
- 人物视线方向是否有留白；
- 全身镜头头、手、脚是否完整；
- 背景线条是否切过头颈；
- Outpaint 后主体是否失去尺度和视觉重心。

P0 只将这些意图编译到 prompt、构图辅助线和质量清单，不建设伪 3D 求解器。

### 6.2 相机

```ts
type CameraIntent = {
  angle?: "eye_level" | "high" | "low" | "top_down" | "dutch";
  view?: "front" | "three_quarter" | "profile" | "back";
  lensFeel?: "wide" | "normal" | "portrait" | "telephoto";
  cameraDistance?: "near" | "medium" | "far";
  eyeLineTarget?: {
    type: "camera" | "character" | "object" | "offscreen";
    targetCharacterId?: string;
    targetObjectId?: string;
  };
};
```

Story 连续性额外记录：

- `spatialAxis`；
- `screenSide`；
- `facingDirection`；
- `relativeDepth`；
- `relativeScale`；
- 对话镜头的 eyeline pair。

### 6.3 光影

```ts
type LightingIntent = {
  keyDirection?: "front" | "left" | "right" | "back" | "top";
  softness?: "hard" | "balanced" | "soft";
  colorTemperature?: "cool" | "neutral" | "warm" | "mixed";
  contrast?: "low" | "medium" | "high";
  timeOfDay?: "dawn" | "day" | "golden_hour" | "night" | "interior";
  practicalLights?: string[];
};
```

Story 记录 `lightAnchor`，用于跨镜头保持：

- 主光方向；
- 色温；
- 阴影软硬；
- 时段；
- 可见灯源。

P0 只做语义约束和人工检查，不承诺物理光照重建。

### 6.4 人体骨骼与姿势

职责分为四层：

```text
Detector / Editor
→ PoseAsset
→ Pose Control Adapter
→ GeneratedHumanQA
```

- Detector/Editor 负责关键点和条件图；
- PoseAsset 保存来源、格式、revision 和 render spec；
- Adapter 负责模型家族和真实 ControlNet；
- GeneratedHumanQA 检查输出人体；
- OpenPose 预检不等于人体结果通过；
- FaceID、Pose、Outfit 与 prompt 分别控制；
- P0 默认 `maxPersons=1`；
- 复杂多人、DensePose、SMPL 和视频姿势后置。

Story P0 可以保存 `PoseIntent`，但只有在 Pose MVP 通过后才能宣称真实 Pose Control。

### 6.5 场景延伸与 Outpaint

```ts
type OutpaintContinuityPlan = {
  direction: "up" | "down" | "left" | "right" | "outward";
  preserveOriginalPixels: boolean;
  forbidHardSeam: boolean;
  structuralAnchors?: Array<{
    type: "horizon" | "vanishing_point" | "wall_line" | "floor_line" | "light_source";
    value: unknown;
  }>;
  colorAnchor?: {
    exposure?: string;
    colorTemperature?: string;
  };
};
```

向上扩图专项：

- 保护头发、脸和人物轮廓；
- 避免头顶重复主体、光环和相机伪影；
- 延续背景透视和光源；
- 记录 overlap、feather、mask 和后处理；
- 结果检查人物边缘、曝光、色温、透视和接缝。

---

## 7. Story 领域模型

### 7.1 实体

```text
StoryWorkflow
├─ CreativeSpec
├─ CharacterSheet[]
├─ Scene[]
│  └─ SceneContinuityPack
├─ Beat[]
└─ Shot[]
   ├─ ShotMeta
   ├─ StoryCompositionOverrides
   ├─ StoryArtifactBinding[]
   └─ CompilationState
```

### 7.2 Stable ID

以下对象使用稳定 ID：

- story；
- character；
- scene；
- beat；
- shot；
- artifact binding。

名称变化不得破坏引用。

### 7.3 SceneContinuityPack

```ts
type SceneContinuityPack = {
  sceneId: string;
  characterStates: Array<{
    characterId: string;
    outfitRecipeId?: string;
    poseSummary?: string;
    screenSide?: "left" | "center" | "right";
    facing?: "left" | "right" | "camera" | "away";
    relativeDepth?: "foreground" | "midground" | "background";
    relativeScale?: number;
  }>;
  propStates: Array<{
    propId: string;
    holderCharacterId?: string;
    state?: string;
  }>;
  spatialAxis?: string;
  eyeLinePairs?: Array<{
    fromCharacterId: string;
    toCharacterId: string;
  }>;
  lightAnchor?: LightingIntent;
  environmentState?: string;
  revision: number;
};
```

### 7.4 ShotMeta

```ts
type ShotMeta = {
  shotId: string;
  sceneId: string;
  beatId?: string;
  narrativePurpose:
    | "establish"
    | "reveal"
    | "reaction"
    | "action"
    | "insert"
    | "transition"
    | "resolution";
  subjectIds: string[];
  compositionOverrides?: StoryCompositionOverrides;
  continuityOverrides?: Partial<SceneContinuityPack>;
  coverageOfShotId?: string;
  revision: number;
};
```

### 7.5 StoryArtifactBinding

```ts
type StoryArtifactBinding = {
  bindingId: string;
  storyId: string;
  shotId?: string;
  artifactNodeId: string;
  artifactRevision: number;
  executionPlanId?: string;
};
```

绑定和资产生命周期分离。删除 binding 不删除 artifact。

---

## 8. Story → Generation Core 编译

### 8.1 Adapter

```text
StoryWorkflow
  + CharacterSheet
  + SceneContinuityPack
  + ShotMeta
  + 用户覆盖
        ↓
StoryGenerationAdapter
        ↓
GenerationIntent
        ↓
Shared PromptCompiler / CapabilityRegistry
        ↓
OperationProfile / ExecutionPlan
        ↓
共享执行器
```

### 8.2 编译规则

1. 读取 CreativeSpec；
2. 合并 CharacterSheet；
3. 合并 SceneContinuityPack；
4. 应用 ShotMeta；
5. 应用用户明确覆盖；
6. 解析 ReferenceBinding；
7. 检查 CapabilityRegistry；
8. 生成 ExecutionPlan；
9. 用户确认后执行。

### 8.3 禁止规则

- Story 不直接选择 ComfyUI 文件；
- Story 不动态拼节点；
- Story 不绕过 CapabilityRegistry；
- Story 不把模型降级隐藏在最终提示词里；
- Story 不自动触发批量生成；
- Story 不因缺少真实 Pose 能力而假装完成换姿。

---

## 9. 工作流模板与交互

### 9.1 P0 模板

```text
creative_spec
→ script
→ character_sheet
→ scene
→ beat
→ shot
→ keyframe placeholder
→ clip placeholder
```

创建规则：

- 用户先预览节点数量；
- 默认只建链；
- 生成任务数为 0；
- 可从已有剧本抽取，也可手动建立；
- 生成占位节点不等于发起任务。

### 9.2 镜头生成交互

1. 选中 Shot；
2. 展示继承摘要；
3. 展示构图、相机、光源、姿势和场景；
4. 展示 ReferenceBinding；
5. 展示能力与降级；
6. 展示 ExecutionPlan；
7. 用户确认；
8. 执行；
9. 写入普通结果节点和 StoryArtifactBinding。

### 9.3 stale 交互

上游变化时：

```text
此镜头的动作或场景已变化。
当前结果基于旧版本生成。

[重新编译] [继续使用旧结果] [查看影响] [解除绑定]
```

---

## 10. 功能分期

### 10.1 P0A：Shared Core 契约

- GenerationIntent；
- CompositionContext；
- ReferenceBinding；
- PromptCompiler 适配层；
- OperationProfile / ExecutionPlan；
- CapabilityRegistry；
- QualityCheckResult；
- 直接下游 stale；
- Story 类型只能引用 Shared Core。

### 10.2 P0B：独立能力先行

- 独立生图接入专业指导；
- Outpaint 连续性和结果检查；
- Inpaint 保护规则；
- Pose MVP 按 `pose-control-development-plan.md` 独立完成；
- 提示词组合器输出可解释块；
- Character Atelier 通过能力 ID 消费运行时能力。

Pose P0 只要求：

- 单人；
- 骨架预览；
- `render_only` 或 `structured` 诚实模式；
- 真实 ControlNet 生效；
- FaceID × ControlNet 联合主路；
- FaceID 只通过 CapabilityRegistry 消费：当前 InsightFace `buffalo_l` 仅限 non-commercial research use，Story 不得把本地研究链路包装成可商用生产能力；
- ExecutionPlan 可解释；
- 固定基础姿势集。

关节拖拽、复杂遮挡、双人、自动人体 QA 不属于 Pose P0。

### 10.3 P0C：Story 建链

- 一键创建基础节点；
- Stable ID；
- SceneContinuityPack；
- ShotMeta；
- StoryGenerationAdapter；
- StoryArtifactBinding；
- stale 和重新编译；
- 创建时不自动生成。

Story P0 可保存 PoseIntent，但真实姿势生成依赖 Pose MVP。

### 10.4 P1：专业 UI 与结构化控制

- 结构化骨架编辑器；
- Pose Scaffold Preflight；
- 人工 GeneratedHumanQA；
- 构图参考线和安全区；
- 连续性编辑 UI；
- Story 检查清单；
- LLM 剧本抽取；
- 参数来源可视化；
- Character Atelier 接入 Pose Foundation；
- 角色相对尺度和镜头距离连续性。

### 10.5 P2：高级姿势、视频与成片

- DensePose；
- SMPL；
- 多人物区域身份；
- 视频姿势关键帧和插值；
- CameraMotion / SubjectMotion；
- first/last frame；
- 跨镜头光源自动检查；
- 多 clip 预览；
- 分镜表和剪辑交换格式评估。

---

## 11. Quality Gate

### 11.1 结构

```ts
type QualityCheckResult = {
  checkId: string;
  dimension: string;
  status: "not_run" | "pass" | "warning" | "reject";
  reason?: string;
  evidence?: Record<string, unknown>;
  evaluator: "deterministic" | "model" | "human";
  overriddenByHuman?: boolean;
};
```

### 11.2 共享维度

生成前：

- 能力和模型配对；
- 引用缺失；
- 画幅安全；
- PoseAsset schema；
- 保护区；
- 工作流运行时。

图片生成后：

- 身份；
- 服装；
- 人物数量；
- 人体和手脚；
- 裁切；
- 构图；
- 接地；
- 穿模；
- 背景透视；
- 光源和曝光；
- 接缝。

视频后：

- 身份和服装一致；
- 运动合理；
- 闪烁；
- 背景稳定；
- first/last frame；
- 镜头运动。

未校准的自动分数不得作为唯一阻断。

---

## 12. 验收标准

### 12.1 架构验收

- [ ] 无 Story 可独立生图、扩图、局部编辑和换姿；
- [ ] Shared Core 不导入 Story 类型；
- [ ] Story 不含物理模型文件名；
- 🟨 独立画布 Comfy 生图/重试已写 Shared ExecutionPlan；Story 尚未接入同一编译入口；
- [ ] Story 不存在第二套 Prompt/Outpaint/Inpaint/Pose 执行器；
- [ ] Story artifact 解绑后可继续编辑。

### 12.2 Shared Core 验收

- ✅ 类型只有一个权威定义；
- ✅ `CanvasOperationKind` 与媒体类型分离；
- ✅ ReferenceBinding 区分身份、服装、姿势、场景和风格；
- ✅ PromptCompiler 输出字段来源；
- ✅ CapabilityRegistry 返回明确降级；
- 🟨 独立画布已保存提交前 runtime snapshot（模型、可证明的 WorkflowBinding/工作流哈希、资产哈希、降级原因），Exact Replay 会保留旧快照并重新执行当前 gate；专用参考模式不猜测 binding，Gateway 运行后事实回执待补；
- ✅ 直接下游 stale 可见；
- [ ] Exact Replay 缺资产明确失败。

### 12.3 Outpaint 验收

固定集至少覆盖：

- 头顶贴近上边缘；
- 头发穿过边界；
- 左右边缘人物；
- 室内直线；
- 户外地平线；
- 逆光、暖室内、霓虹；
- 动漫和平涂；
- 摄影写实。

每例检查：

- [ ] 原图保护区无非预期漂移；
- [ ] 头发和人物轮廓无明显硬缝；
- [ ] 曝光和色温无突变；
- [ ] 透视延伸合理；
- [ ] 无重复主体；
- [ ] 失败原因可复现。

### 12.4 Pose P0 验收

固定集：

- 单人正面站姿；
- 三分之四站姿；
- 简单坐姿；
- 背身；
- 手臂交叉；
- 手靠近脸；
- 低机位全身；
- 半遮挡坐姿；
- 动漫和写实各一组。

验收：

- [ ] 默认 `maxPersons=1`；
- [ ] PoseAsset 诚实标记 `render_only/structured`；
- [ ] PoseRenderSpec 固定；
- [ ] ControlNet on/off 有可辨识差异；
- [ ] FaceID off/on × ControlNet off/on 四格完成；
- [ ] 联合主路不会明显拉回旧姿势；
- [ ] SD1.5 与 SDXL 家族错配被阻断；
- [ ] ExecutionPlan 分别显示 Pose、Identity、Outfit 和 prompt；
- [ ] 输出再检测记录 OKS 或归一化关节距离；
- [ ] 服装保持明确标记 best-effort；
- [ ] 删除 Story 绑定后 PoseAsset 仍可独立使用。

以下不作为 P0 阻断：

- 关节拖拽；
- 锁骨长和地面吸附；
- 双人互动；
- 跑、跳、躺等复杂动作；
- 自动人体质量总分；
- Character Atelier RegionObservation 作废。

### 12.5 Pose P1 验收

- [ ] 结构化关节拖拽和镜像；
- [ ] schema 按名称映射；
- [ ] 骨长/对称/地面约束第二阶段可用；
- [ ] Pose Scaffold Preflight；
- [ ] 人工 GeneratedHumanQA；
- [ ] Atelier 接入后换姿使旧 RegionObservation 作废；
- [ ] 多人能力仍以实验开关控制。

### 12.6 Story P0 验收

- [ ] 一次创建基础节点链；
- [ ] 创建时生成任务数为 0；
- [ ] stable ID 不随名称变化；
- [ ] SceneContinuityPack 可继承；
- [ ] Shot 覆盖优先于 Scene；
- [ ] 上游变化使直接下游 stale；
- [ ] Story 可编译为共享 GenerationIntent；
- [ ] 真实 Pose 镜头调用同一 Pose Adapter；
- [ ] 解除绑定不删除普通资产。

---

## 13. 存储与安全

- Story 元数据和绑定保存在浏览器本地；
- 当前不宣称已支持云同步；
- 图片、视频和大二进制继续使用现有本地资产方案；
- PoseAsset P0 权威存储为浏览器 localforage；
- Gateway 只保存执行快照和哈希；
- AI API Key 保存在浏览器本地，不进入 Story、ExecutionPlan、日志或导出包；
- 导出不包含 API Key、本机绝对路径和临时签名 URL；
- 敏感资产按 Character Atelier 的生命周期规则处理。

---

## 14. 实现顺序

统一排期以 `docs/infinite-canvas-unified-development-plan.md` 为准：

1. M0 Shared Core 契约冻结；
2. M1 Outpaint 最终实图验收；
3. M2 CapabilityRegistry / WorkflowBinding / Runtime Preflight；
4. M3 Gateway 自动参考图注入；
5. M4 Pose MVP；
6. M5 Character Atelier 基础能力；
7. M6 Story P0 只建链；
8. M7 发布物料；
9. M8 骨架编辑器与人体 QA；
10. M9 DensePose/SMPL/多人/视频。

Story 可以在 M0 后开发纯建链与编译，但“真实 Pose 镜头生成”必须等待 M4。

---

## 15. 文档纪律

- 本 PRD 定义目标，不代表功能已经实现；
- 物理模型与 workflow 只在 Mission_manager registry 维护；
- 总排期只在统一开发计划维护；
- 功能完成后从 TODO 移到 `pending-test.mdx`；
- BOSS 验收后再更新正式功能说明；
- 文档变化不得虚报为已实现能力；
- 不为了兼容旧本地数据增加平行 schema；
- 不覆盖其他会话未提交的功能代码。

---

## 16. 交付定义

> Story Workflow 交付的不是一套封闭生图工具，而是一套可选的故事编排层：它把人物、场景、镜头和连续性编译为 Shared Generation Core 能理解的意图，并调用与独立生图、扩图、局部编辑、换姿和 Character Atelier 完全相同的基础能力。
