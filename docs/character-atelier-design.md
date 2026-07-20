# 角色部件工坊（Character Atelier）设计文档 v0.4

> 目标一句话：把「一张角色图」拆解成可管理、可替换、可重组的**部件库**，
> 像奇迹暖暖 / 无限暖暖那样自由捏脸、换发型、换衣服、换姿势，
> 最后在本地无限画布里组合生成新图。

> 当前版本：v0.4。跨域排期接入统一总控，类型权威统一到 Shared Generation Core；Florence2、BiRefNet、Qwen Edit、Upscale 仅通过能力路由接入；Outpaint 受 Gate 0 收敛与 Gate A 验收阻塞。

---

## 0. 定位与结论

1. **近期产品定位：语义驱动的受控局部编辑 + 部件灵感库。**
   单张图拆出的 mask / cutout 是与姿势、视角、光照绑定的**观测数据**：遮挡区域缺失、发丝/皮肤/衣物边界粘连、无正反面信息，换姿后全部失效。它们不天然等于可跨图复用的「游戏部件」。「像游戏资源一样确定性拆件并任意重组」按远期方向管理（§14），近期一切对外承诺围绕受控局部编辑展开。
2. **系统第一不变式：蒙版硬保护 > 提示词软约束。**
   身份、胯下、非编辑区的保护必须落在可执行的蒙版契约与生成后校验上（§4），提示词只做辅助。这是本项目此前换姿/局部重绘反复翻车的直接教训。
3. **底座已有约 60%。**
   - 画布前端：蒙版手绘编辑、裁剪、提示词组合器、智能排序已就位；现有「切图」只是网格几何切图，不认识语义部位。
   - 网关：face/hair/skirt 串行 refine、通用 inpaint、Qwen Image Edit 直跑、FaceID/IPAdapter 身份锁、换姿 character-lock 管线。
   - Windows ComfyUI：分割/姿态/打标/梯度蒙版节点齐备且冒烟通过（§2.3），语义拆解层零安装。
4. **本设计补齐 6 块核心能力：**
   1. 领域模型四实体（Extraction / RegionObservation / PartDefinition@Revision / OutfitRecipe）
   2. 蒙版硬保护契约（MaskAsset + EditPlan + 有效编辑区合成 + 漂移检测）
   3. 异步任务协议（Job 状态机 + 任务卡片）
   4. 语义拆解管线（服装 parsing 主路 + SAM 补洞 + 多模型打标融合）
   5. 分级重组管线（破坏半径 + capability gate 路由）
   6. 产品门面（拆解核对台 + 展板 + Outfit 回放）
5. **VTON：** 产品化排在 P4；技术 Spike 提前到 P0A（CatVTON 项目口径 bf16 1024×768 <8G 显存；ComfyUI 接入使用社区/相关节点，不表述为官方节点；许可证 CC BY-NC-SA 非商用，必须记录进能力矩阵）。
6. **存储第一天使用 SQLite（WAL + 外键 + 软删除）+ content-addressed 资产文件**，不做 JSON 索引过渡。
7. **物理模型与工作流由 Mission_manager Registry 管理。** Character Atelier 只使用 capability ID、WorkflowBinding 和 ExecutionPlan，不保存模型文件名、Windows 物理路径或动态节点拼装规则。跨域总排期以 `docs/infinite-canvas-unified-development-plan.md` 为唯一入口。

---

## 1. 需求与约束

### 1.1 需求还原

从图一（世界名画服饰拆解）和图二（丝袜风格提案板）提炼：

| 诉求 | 说明 | 对应游戏概念 |
|---|---|---|
| 拆 | 把角色图拆成发型/脸/衣/腿饰/鞋/姿势/背景等 | 暖暖部件栏 |
| 库 | 部件存档：观测切图 + 结构描述 + 提示词 + 色板 | 衣橱 |
| 换 | 任意槽位单独替换 | 搭配 |
| 组 | 多槽重组生成自然融合新图 | 出场图 |
| 展 | 拆解展板 / 风格提案板 | 图鉴 |

### 1.2 硬约束

- 生图在 **Windows ComfyUI（192.168.2.157:8188）**，Mac 只做编排。
- 角色一致性是命门。
- 入口长在**画布图片节点**（文生图抽卡 → 再加工）。
- BOSS 看图反馈；代理侧不读敏感成图，只读日志与结构化结果。
- Mac 终端代理会劫持局域网流量：脚本访问 192.168.2.x 必须 `--noproxy '*'`；网关进程自身直连不受影响。

---

## 2. 现状盘点

### 2.1 画布前端（infinite-canvas/web）

| 能力 | 文件 | 与本设计的关系 |
|---|---|---|
| 网格切图 | `canvas-node-split-dialog.tsx` | 仅提案板拼图，无语义 |
| 蒙版局部编辑 | `canvas-node-mask-edit-dialog.tsx` | ★★★ 人工精修回环的骨架，复用不重造 |
| 裁剪 | `canvas-node-crop-dialog.tsx` | 部件特写提取 |
| 提示词组合器 | `canvas-prompt-library.tsx`（v15.6） | 词冲突/排序/身份包/场景模板 |
| 智能排序 | `smart-compose-prompt.ts` | slot → token 后的排序底座 |

### 2.2 网关（llama_ui_gateway.py，v14.3）

已有准部件能力：

- face / hair / skirt 几何蒙版 + 串行 refine
- 通用 inpaint mutator
- Qwen Image Edit 2511 直跑
- FaceID / IPAdapter / identity densify / 服装锚点
- pose-change character-lock 独立路径

短板：蒙版靠几何估算、部位 hardcode、无部件持久化、无槽位/互斥/层模型、无任务协议。

### 2.3 Windows ComfyUI 实测

- 总节点 2284；分割/姿态/打标相关 351。
- **分割/打标可用**：`SAM3Segment` / `SAM2Segment`、`ClothesSegment` / `BodySegment` / `FaceSegment`、`LayerMask: SegformerB2ClothesUltra`、`BiRefNetRMBG`、`OpenposePreprocessor`、`DWPreprocessor`、`DeepDanbooruCaption`、`Florence2Run`。
- **SDXL 姿势控制已在位**：`ControlNetLoader` 已枚举 `controlnet-openpose-sdxl-1.0\diffusion_pytorch_model.safetensors`、`diffusion_pytorch_model_twins.safetensors` 和 `controlnetxlCNXL_2vxpswa7OpenposeV21.safetensors`；默认候选文件位于 `E:\nannan-ai-toolchain\models\controlnet\controlnet-openpose-sdxl-1.0\diffusion_pytorch_model.safetensors`，SHA256 为 `B8524E557A7DF60D081F5D4A0EB109967D107DF217943BF88C2D99B9EBCC06C5`。
- **当前缺口在应用层**：模型和预处理节点已具备，但无限画布的换姿仍是提示词 + FaceID 路线，尚未形成 PoseAsset、骨架预览/编辑、ControlNet 参数计划和生成后人体 QA。
- **梯度蒙版链路在位**（`object_info` 核验）：`DifferentialDiffusion`、`InpaintModelConditioning`、`FeatherMask`、`GrowMask`、`GrowMaskWithBlur`、`ImpactGaussianBlurMask`、`MaskBlur+`、`ImageCompositeMasked`——零安装。
- **冒烟**：`ClothesSegment` 对真实画布图 17s 产出 mask + cutout。
- **暂缺本地 VTON**：无 CatVTON / IDM-VTON；仅 `KlingVirtualTryOnNode`（云，不作默认）。

---

## 3. 领域模型

### 3.1 四实体拆分

同一条「裙子」在系统里有三种本质不同的存在，禁止用一个 `part` 混装：

| 概念 | 实体 | 生命周期 |
|---|---|---|
| 这张图上的裙子区域 | `RegionObservation` | 与源图 revision 绑定；换姿/换图即失效 |
| 可复用的「这款裙子」 | `PartDefinition` @ `PartRevision` | 人工批准后长期演化，每次修改产生新 revision |
| 生成同款裙子的方法 | `OutfitRecipe` 引用 + 生成参数 | 与 workflow/模型/seed 版本绑定 |

```text
SourceImage（源图资产，content-addressed）
  └─ Extraction（一次拆解任务，绑定 workflow id/hash）
      └─ RegionObservation（mask/bbox/cutout/scores；姿势绑定的观测）
          └─ promote ──▶ PartDefinition @ PartRevision（人工批准的可复用部件，版本化）
```

- `OutfitRecipe` 只允许引用明确的 `PartDefinition@revision`，禁止引用浮动 `part_id`，禁止直接引用 Observation。
- 完整实体清单：`Asset / SourceImage / Extraction / RegionObservation / PartDefinition / PartRevision / CharacterProfile / OutfitRecipe / CompositionPlan / Job / WorkflowCapability`。

这样拆的直接收益：同件衣服跨图可归并；换姿后失效的观测不会被误当可用部件；脏 cutout 与 semantic 描述不会互相漂移；人工重打标有明确的版本落点；Outfit 回放有稳定引用。

### 3.2 RegionObservation

```jsonc
{
  "id": "obs-xxx",
  "schema_version": 1,
  "extraction_id": "extract-xxx",
  "source_asset_id": "asset-image-xxx",
  "source_revision": "sha256:...",
  "canonical_slot": "legwear",
  "mask_asset_id": "asset-mask-xxx",
  "cutout_asset_id": "asset-cutout-xxx",
  "bbox_px": [120, 430, 780, 1480],
  "image_size": [1024, 1536],
  "occluded": true,
  "visibility_ratio": 0.72,
  "scores": { "class": 0.91, "boundary": 0.63 },
  "review_status": "needs_review",
  "workflow": { "id": "clothes-segment-v1", "hash": "sha256:..." }
}
```

### 3.3 PartDefinition 与 PartRevision

```jsonc
{
  "id": "partrev-xxx",
  "part_id": "part-xxx",
  "revision": 3,
  "canonical_slot": "legwear",
  "semantic": {
    "concepts": ["fishnet", "glitter", "thigh_high"],
    "prompt_en": "black glitter fishnet thighhighs",
    "prompt_zh": "黑钻细闪网格过膝袜",
    "negative_prompt": ["solid opaque stockings"]
  },
  "visual_preview_asset_id": "asset-cutout-xxx",
  "palette": {
    "colors": ["#0a0a0a", "#c0c0c0"],
    "algorithm": "kmeans-v1",
    "mask_erode_px": 4,
    "palette_unreliable": false
  },
  "compatibility": {
    "occupies": ["legs"],
    "occludes": ["skin_legs"],
    "conflicts_with": [],
    "requires": ["body"],
    "may_coexist_with": ["shoes"],
    "z_order_by_region": { "legs": 20 }
  },
  "reference_asset_ids": [],
  "source_observation_ids": ["obs-xxx"],
  "status": "approved",
  "created_by": "user",
  "deleted_at": null
}
```

### 3.4 三态资产的落位

| 态 | 落位 | 用途 |
|---|---|---|
| **Visual**（mask/cutout/bbox/palette） | RegionObservation | 当前图的编辑边界、展板、预览 |
| **Semantic**（concepts/prompt/negative） | PartRevision 主体 | 驱动 inpaint / 组合器 |
| **Reference**（干净单品图） | PartRevision.reference_asset_ids | 跨图取件 / VTON 输入；预留 VTOFF「canonical garment image」（穿着照反推标准姿态平铺服装图）的清洗产物位置 |

原则：

- 换件优先 **Semantic** 驱动生成；**Visual** 只管蒙版边界与预览。
- **Reference** 仅高质量单品图启用。
- 脏 cutout 禁止硬贴进成图，只允许提案板预览。

### 3.5 canonical slots（持久层槽位）

```text
body · face_identity · expression · hair_front · hair_back
top · bottom · dress · outerwear · legwear · shoes
head_accessory · face_accessory · neck_accessory · hand_accessory
held_item · background
```

- 持久层从第一天使用上表 17 个 canonical slots。UI 允许聚合展示（如「下装/连衣裙」一个入口、「头发」一个入口），**聚合名只存在前端，不入库**——避免类似 `bottom_or_dress` 的临时枚举进库后无损迁移不了。
- `expression` 与 `face_identity` 持久化独立（表情编辑与身份编辑的风险等级完全不同）；第一版 UI 可以合并展示。
- `hair_front / hair_back` 拆开，是为了处理发丝夹脸、脸前肩后的交错层叠——这是动漫角色分层的常态而非特例。

### 3.6 层与互斥（区域化规则）

不使用全局单值 `layer`。覆盖/遮挡关系按身体区域表达，规则表**版本化存 SQLite**，不散落前端：

```jsonc
{
  "slot": "dress",
  "occupies": ["torso", "pelvis", "upper_legs"],
  "occludes": ["top", "bottom", "legwear"],
  "may_coexist_with": ["outerwear", "shoes"],
  "conflicts_with": [],
  "requires": ["body"],
  "z_order_by_region": { "torso": 30, "legs": 20 },
  "conditional_rules": ["slip_dress_allows_inner_top"]
}
```

必须支持的典型场景：长发脸前/肩后 z 序不同；外套盖 top 不盖 bottom；丝袜在皮肤上、鞋下；裙摆盖腿不盖鞋尖；dress 默认与 top/bottom 冲突但吊带裙允许内搭 top。因此互斥必须支持条件规则，不能写死全局互斥组。

### 3.7 CompositionContext（姿势/镜头/场景不是槽位）

pose 会改变所有空间资产、遮挡关系和身体轮廓，与鞋、发型不是同级概念。组合公式：

```text
CharacterProfile + OutfitRecipe + CompositionContext(Pose/Camera/Scene) → CompositionPlan
```

- `CompositionContext`、`PoseIntent`、`CameraIntent`、`SceneIntent` 的 schema 唯一权威位于 Shared Generation Core；Character Atelier 只引用或提交局部覆盖，不在本域定义同名平行类型。
- Pose 资产由 Pose Foundation 管理；Atelier 只引用 `poseAssetId + revision + contentHash`，真实执行按 `docs/pose-control-development-plan.md` 走共享 Pose Adapter。
- P0 PoseAsset 的可编辑权威副本在浏览器 localforage；网关 Atelier SQLite 只保存本次执行引用、快照哈希与 Observation 失效结果，不维护第二份可编辑关键点。
- **换姿后旧 RegionObservation 全部作废**，必须重新分割；系统层面禁止沿用旧空间观测。

### 3.8 CharacterProfile

```jsonc
{
  "id": "char-xxx",
  "identity_revision": 2,
  "immutable_identity": { "face_shape": "...", "eye_color": "blue", "skin_tone": "..." },
  "default_appearance": { "hair": "long brown hair with teal tips", "makeup": "natural" },
  "body_constraints": { "body_type": "slim", "height_ratio": "...", "locked": true },
  "mutable_traits": ["hair_style", "hair_color", "outfit"],
  "reference_embeddings": { "model": "faceid-v2", "version": "...", "hash": "sha256:..." },
  "face_ref_asset_ids": ["asset-..."],
  "banned_drift_terms": ["yellow tint"],
  "protected_regions_policy": "face_always + crotch_default",
  "default_outfit_recipe_id": null
}
```

- 默认发型放 `default_appearance`，**不**写入 `immutable_identity`——发型是可换槽，混进不可变身份会和换发型互相打架。
- 身材/胸型 = `body_constraints`：默认锁定、独立风险等级；不混入只读 body mask，也不做普通可换槽。
- 拆解满意的抽卡图时自动建档；之后所有换件任务都挂 Profile。

### 3.9 OutfitRecipe 与回放语义

两种回放模式，API 与 UI 必须显式区分，不允许把「重新随机生成」叫做回放：

| 模式 | 语义 | 必须保存 |
|---|---|---|
| **Exact Replay** | 相同环境重放，输出 hash 一致（或明确标注节点级不确定性） | workflow id/version/hash、模型+LoRA hash、seed/sampler/scheduler/steps/CFG、输入资产 revision、mask revision、prompt 编译结果、protect policy version、route plan、输出资产 id |
| **Semantic Regenerate** | 按语义重新抽卡相似结果，不承诺像素一致 | 槽位 → `PartDefinition@revision` 引用、Profile 引用、CompositionContext |

模型缺失、workflow 升级、part revision 变化时必须给出明确提示（验收见 §10.5）。

### 3.10 存储

- 元数据/关系/Job 状态 → **SQLite**：WAL、外键、软删除（`deleted_at`）、schema migration 版本化。
- 图片/mask/cutout → **content-addressed 文件系统**（sha256 目录）；数据库只存 asset id/hash/path，JSON 里不出现本机绝对路径。
- 全实体通用字段：`schema_version`、`revision`、`content_hash`、`source_image_revision`、workflow id/hash、`review_status`、`created_by`、`deleted_at`。
- **不做 JSON 索引过渡**：部件/Profile/Outfit/Job 会被多任务并发更新，JSON 缺事务、唯一约束与版本冲突控制；取消任务、重复入库、人工重打标、删除源图都会破坏引用。本地单机系统 SQLite 就是合适复杂度。
- 落点：网关侧 `Mission_manager/data/atelier/`（已拍板，§16）。

---

## 4. 蒙版与硬保护契约

「硬保护优先」必须形式化，否则只是文档口号。本节契约覆盖：mask 对应哪版源图、坐标与语义、变换规则、多 mask 合成顺序、执行前编译、执行后校验。

### 4.1 MaskAsset

```jsonc
{
  "mask_asset_id": "asset-mask-xxx",
  "source_image_revision": "sha256:...",
  "width": 1024,
  "height": 1536,
  "coordinate_space": "source_pixel",
  "semantics": "editable_white",
  "mask_mode": "binary",
  "threshold": 0.5,
  "feather_px": 8,
  "dilate_px": 4,
  "regions": ["legwear"],
  "derived_from": { "workflow_id": "segment-clothes-v3", "model_versions": {} }
}
```

约定：

- `coordinate_space` 一律源图像素系；`semantics` 全系统统一为「白 = 可编辑区」，禁止歧义。
- `mask_mode`：`binary`（二值）或 `strength_gradient`（灰度 = 逐像素允许改动强度）。梯度模式走 Differential Diffusion 路线（蒙版模糊节点 + `DifferentialDiffusion` + `InpaintModelConditioning`），标准底模即可用，无需专用 inpaint checkpoint；社区经验 denoise 0.6–0.8 较稳，过度羽化会波及周边。R0 材质级替换默认用梯度蒙版减接缝。相关节点已在本机 Comfy 核验在位（§2.3），零安装。
- 源图裁剪/缩放/旋转后：mask 按记录的变换矩阵重投影，或直接作废重出；`source_image_revision` 不匹配时执行器必须拒绝。

### 4.2 EditPlan（执行前编译产物）

```jsonc
{
  "edit_plan_id": "plan-xxx",
  "requested_regions": ["legwear"],
  "denoise_mask_asset_id": "asset-mask-a",
  "blend_mask_asset_id": "asset-mask-b",
  "context_mode": "selection_bounds",
  "protect_masks": ["face_protect", "crotch_protect", "user_protect"],
  "effective_edit_mask": "asset-mask-eff",
  "drift_check": { "enabled": true, "tolerance_profile": "default-v1" }
}
```

- **denoise_mask ≠ blend_mask**，必须是两个字段：前者控制生成扩散范围（相对过渡带，随强度缩放），后者控制结果回贴的 alpha（绝对像素过渡带）。这是 Krita AI Diffusion 从一个选区派生 Feather/Blend 两张蒙版的成熟实践。
- `context_mode`（`selection_bounds | entire_image | custom_region`）显式化上下文成本——整个 context 都要付算力，不只是蒙版区。

### 4.3 有效编辑区合成公式

```text
effective_edit_mask
= requested_region
− face_protect
− crotch_protect
− user_protect
− other_locked_regions
```

- **face_protect**：改非脸槽时永远从编辑蒙版物理挖掉脸区，FaceID 强锁叠加。
- **crotch_protect**：R18 下体保护区由 **body parsing / keypoints 推导**（禁止固定几何框），用户可编辑。推导先例：SegAnimeChara（SIGGRAPH 2023 Posters）用 OpenPose 骨架 + BodyPix 式体积化身体分区零样本切动漫部位再交 SAM 细化——胯下区可用同法从骨盆关键点长出体积区域。
- 改脸槽时反向：只开放脸区，身份词降权、目标特征置顶。

### 4.4 生成后保护区漂移检测

- 输入 mask 可视化快照必须落盘存档。
- 输出后对每个保护区计算变化（LPIPS/SSIM 或特征距离），设定颜色/压缩/全局光照容差。
- 超阈值 → Job 进入 `awaiting_review` 或 `failed_protection_check`，自动标记失败/回滚/要求人工确认。
- **face-refine 之后必须二次检查**——refine 本身可能再次改脸，不得跳过。
- Regional prompting（Attention Couple 等区域 conditioning）只作为**软辅助层**，永不进入硬保护链路。

---

## 5. 语义拆解管线

### 5.1 模型编排

| 方案 | 用途 | 本机策略 |
|---|---|---|
| ClothesSegment / SegformerB2ClothesUltra | 一键多部位服装 parsing | **主路**（17 类开关） |
| SAM3 / SAM2 文本分割 | 开放词**补洞/先验**（荷叶边/蝴蝶结/网格丝袜） | **锁死为兜底**，不当主 parser |
| BiRefNet / rembg / 动漫角色抠像 | 透明底净化；多角色图先隔离单角色 | 入库前置步骤 |
| 区域裁剪 + 多模型融合打标 | semantic 主来源 | parsing 给类别 → Florence2/Qwen-VL 给部件描述 → 动漫风格标签由 wd14 tagger（imgutils `get_wd14_tags`，带 rating/characters）或 DeepDanbooru 补充 |
| OpenPose / DensePose | 姿势资产 + crotch_protect 推导 | CompositionContext 专用 |

当前已登记运行时能力通过 capability ID 消费：

| Capability | Atelier 用途 | 生产边界 |
|---|---|---|
| `vision.describe.florence2` | 反推提示词、部件语义和人工核对辅助 | 输出只作为语义候选，不能自动升格 PartDefinition |
| `vision.cutout.birefnet` | 角色隔离、透明底净化、入库前 cutout | 必须记录边缘质量和人工精修入口 |
| `image.edit.qwen.fidelity` | 身份/服装保真编辑候选 | 保护区漂移 gate 通过前维持实验模式 |
| `image.edit.qwen.multiangle` | 多角度角色素材候选 | 不替代真实 Pose Foundation；需身份与服装一致性评测 |
| `image.upscale.ultrasharp` | 展板、部件预览和发布图放大 | 记录放大模型、倍率和伪细节风险 |

Gateway 自动参考图注入未完成前，以上能力只算“运行时已登记”，不算 Atelier 产品闭环。画布必须提交 `ReferenceBinding[]`，Gateway 根据 WorkflowBinding 注入真实图片输入，并把实际引用与降级回写 ExecutionPlan。

选型依据（外部证据索引见 §15）：

- SAM 系在动漫域只适合做先验/补洞：See-through（SIGGRAPH 2026）按 19 部位对比实测 SAM3 在动漫角色上常产出不完整/重叠的 mask；自然照片训练的 body-part 模型因视觉域差在动漫图上直接失效（CAVW 2024）。
- 开源动漫分割生态（AniSeg、SkyTNT anime-segmentation、CartoonSegmentation，含 ComfyUI 节点包 comfyui_animeseg）全部是**整角色级**前景/实例分割，无部位级 parsing——部位级只能靠「服装 parsing 主路 + SAM 补洞 + 人工核对」组合；角色级模型用作前置抠像。
- SegAnimeChara 的「OpenPose 骨架 → 体积化部位 → SAM 细化」是皮肤/四肢类身体区域分割的候选补路，P0A 评测一并对比。

拆解产物 = `RegionObservation`（§3.2），含 mask + cutout + bbox + scores + visibility_ratio + occluded。

palette 提取记录算法与 erode 参数；透明丝袜、阴影、肤色透出场景下聚类会把皮肤色当服装色，此类观测标 `palette_unreliable`。

### 5.2 质量分与人工回环

不使用未经校准的单值 confidence（不同模型分数含义不同，压成一个 0–1 会造成错误信任）：

```jsonc
{
  "scores": {
    "segment_model": 0.91,
    "label_model": 0.72,
    "boundary_quality": 0.64,
    "coverage_consistency": 0.88
  },
  "quality_grade": "needs_review",
  "quality_reasons": ["transparent_material", "boundary_uncertain"]
}
```

- `quality_grade ∈ auto_pass | needs_review | rejected`；阈值经评测集（§10）校准后才生效。校准前 UI 只展示 grade + reasons，不展示综合置信度数字。
- 低质量观测默认不升格 PartDefinition，进现有蒙版编辑器精修——人工回环复用 `canvas-node-mask-edit-dialog`，不另造编辑器。
- 「仅用 semantic、丢弃脏 cutout」开关保留（丝袜网格等高频场景）。

---

## 6. 替换路由与破坏半径

### 6.1 WorkflowCapability 与路由 gate

路由器按能力矩阵选模型，矩阵字段：

```text
capability_id · workflow_binding_id · architecture · base_model_id
publisher · source_repo · sha256 · validated_pairs
supports_mask · supports_reference · supports_identity_adapter
supports_pose_control · supports_seed · supports_region_lock
quality_tier · identity_policy · composition_policy
safety_mode · fallback_policy
license · vram_estimate · p50/p95_latency
```

状态只允许：

```text
candidate · validated · rejected · unverified_candidate
```

`safety_mode` 使用 `hosted_guarded / local_standard / local_abliterated`，不使用信息不足的 `uncensored: boolean`。

运行时能力可用必须同时满足：模型文件存在、Loader 可枚举、所需自定义节点存在、WorkflowBinding 字段匹配、最小 smoke 通过。物理映射只保存在 Mission_manager registry。

- **Qwen Edit 在证明 `supports_region_lock` 前只进实验/建议模式**：全图编辑模型最容易偷改脸、身材、背景，与硬保护不变式直接冲突。实验模式输出必须过 face/protected-region gate，漂移超阈自动拒收；不得作为 R1 默认生产路由。gate 结论由 P0A 实测给出。
- 许可证入矩阵：CatVTON = CC BY-NC-SA 4.0（非商用）、TryOffDiff = SSPL（非商用）；路由与产品化时必须可见。

### 6.2 三条替换路由

| 路由 | 场景 | 阶段 |
|---|---|---|
| A 语义蒙版 + inpaint（含梯度蒙版） | 发色、丝袜纹理、鞋等局部 | P2A |
| B Qwen Edit 指令编辑 | 整件结构大改 | P2B（过 gate 前实验模式） |
| C 图驱动试穿 VTON | B 衣穿到 A | P4 产品化；P0A Spike |

### 6.3 破坏半径

| 半径 | 例子 | 策略 |
|---|---|---|
| R0 | 发色/丝袜材质 | 单次 inpaint（梯度蒙版）+ 脸保护 |
| R1 | 整条裙子 | 大蒙版 inpaint 或 gate 后 Qwen Edit + face refine + 二次漂移检查 |
| R2 | 上衣+裙子 | 串行 R1，中间校验 |
| R3 | 换姿势 | 整图 pose-change character-lock；旧 RegionObservation 全部作废 |
| R4 | 跨图取衣 | 需 Reference 态；无本地 VTON 则拒绝或降级路由 B |

超过 R2 → 拆成**任务卡片队列**：可预览、可取消、人工批准中间产物，禁止黑盒连喷。交互对齐 Krita AI Diffusion 的 queue + cancel + history 与 InvokeAI 的 staging area（接受/拒绝中间结果）模式。

---

## 7. 异步任务协议

生图与分割都是长任务，同步 API 无法承载任务卡片、取消、断线恢复。网关统一实现异步 Job 协议。

### 7.1 API 面（v1）

```http
POST   /api/v1/assets                    # 上传资产（按 hash 去重）
GET    /api/v1/assets/{id}

POST   /api/v1/decompositions            # 202 Accepted → job
GET    /api/v1/decompositions/{id}
POST   /api/v1/decompositions/{id}/regions/{region_id}/review   # 核对/升格

GET    /api/v1/parts
POST   /api/v1/parts
PATCH  /api/v1/parts/{id}                # 携带 expected_revision，冲突返回 409
POST   /api/v1/parts/{id}/revisions

POST   /api/v1/compositions/plan         # plan 与 execute 分离；支持 dry_run
POST   /api/v1/compositions              # 202 Accepted → job
GET    /api/v1/compositions/{id}

GET    /api/v1/jobs/{id}
GET    /api/v1/jobs/{id}/events          # SSE 进度/中间产物
POST   /api/v1/jobs/{id}/cancel          # 语义显式：dequeue 或 interrupt 当前 Comfy prompt

GET    /api/v1/capabilities              # WorkflowCapability 矩阵
GET    /api/v1/health/comfyui
```

### 7.2 Job 状态机

```text
queued → validating → running → awaiting_review → succeeded
                                  └→ failed / cancelled
```

- 创建返回 `202 { job_id, status, plan: { route, risk_level, protected_regions } }`；plan 阶段即可见实际路由、保护区与降级原因。
- 请求支持 `Idempotency-Key`；全请求携带 `schema_version`。
- Job 记录 Comfy prompt/job id 映射、workflow id/version/hash、中间产物列表——断线重连可恢复。
- 错误码必须区分：`input_error / capability_missing / oom / comfyui_offline / protection_drift / human_rejected`。
- workflow 使用注册表 + hash 管理，禁止网关散落动态拼节点。
- 二进制资产只走 asset id 引用。

### 7.3 显存调度

- workflow 预估 VRAM 写入能力矩阵；单 GPU 串行队列。
- 模型驻留策略可配置（decompose 结束 PurgeVRAM、SAM3 `unload_model=true` 是策略选项而非唯一手段）。
- OOM 自动降级（降分辨率/换轻模型）+ 分辨率上限。
- GPU 状态与 Comfy 健康检查暴露在 `/health/comfyui`。
- 计时按阶段拆 p50/p95，不只看总时长。

### 7.4 敏感资产生命周期

- 网关默认仅局域网监听；对外访问必须 token 鉴权。
- 日志不落原图/base64；敏感缩略图可关闭。
- 删除 SourceImage 时对关联 Observation/Part/Recipe 级联提示。
- 临时文件 TTL；导出/共享显式确认。
- R18 评测集与资产单独隔离与访问控制。

---

## 8. 技术架构

```
┌─ Mac 画布前端 ────────────────────────────────┐
│ 拆解核对台 · 展板导出 · 任务卡片 UI             │
│ smart-compose-prompt（slot→token 排序）        │
└──────────────────┬────────────────────────────┘
                   │ REST（异步 Job 协议，§7）
┌──────────────────▼────────────────────────────┐
│ Mac 网关 llama_ui_gateway.py                   │
│ /api/v1/decompositions · compositions · parts  │
│ /api/v1/jobs · capabilities · health           │
│ 存储：SQLite(WAL) + content-addressed assets   │
└──────────────────┬────────────────────────────┘
                   │ ComfyUI HTTP API（直连，workflow 注册表+hash）
┌──────────────────▼────────────────────────────┐
│ Windows ComfyUI 192.168.2.157:8188            │
│ 已有：SAM2/3 · ClothesSegment · Segformer      │
│      DeepDanbooru · Florence2 · OpenPose       │
│      FaceID · IPAdapter · inpaint · QwenEdit   │
│      DifferentialDiffusion 梯度蒙版链路         │
│ 暂缺本地：CatVTON / IDM-VTON（P0A Spike 验证）  │
└───────────────────────────────────────────────┘
```

### 8.1 与提示词组合器的边界

| 提示词组合器 | 角色工坊 |
|---|---|
| token 冲突 / 增强 / 排序 | slot 占用 / 互斥 / 层（版本化规则表） |
| 场景模板 | CompositionContext 的场景配方 |
| 身份包 | Profile 的 semantic 投影 |

compose 链路：**slot → token → smart-compose**，不另起词库中心。

### 8.2 配置隔离契约：手动工作流 / Outpaint / 局部编辑 / 角色工坊

本地工作流设置、提示词组合器和各类托管编辑必须分层，禁止共享一份可变
`comfyExtra` 后互相覆盖。正式优先级：

```text
托管操作的硬约束（mask / protected regions / route / identity gate）
  > 操作面板内的显式设置
  > 源图 GenerationRecipe / CharacterProfile 继承
  > 节点「本地工作流设置」的显式高级覆盖
  > 模型 preset 默认值
```

#### A. 节点「本地工作流设置」

- 定位：普通手动文生图/图生图的自由配置，不是全局策略中心。
- 字段：model / reference mode / LoRA / FaceDetailer / denoise。
- 作用域：默认只作用于该节点发起的普通手动生成及其显式继承子节点。
- 不得自动覆盖 Outpaint、角色工坊、蒙版编辑等托管操作的硬约束。
- 托管操作如允许使用节点设置，必须提供「高级覆盖」开关，默认关闭，并在执行计划中显示实际采用值。

#### B. 提示词组合器

- 只负责 prompt/slot 语义层：冲突、增强、排序、完整性和场景模板。
- 不直接读取、修改 reference mode / LoRA / FaceDetailer / denoise。
- 「组合并生成」只把编译后的 prompt/CompositionContext 交给执行层；实际 workflow 由对应 OperationProfile 选择。
- 当前节点的本地工作流设置可以影响普通手动生成，但不得改变角色工坊和 Outpaint 的托管路由。

#### C. Outpaint（画面扩图）

- 使用独立 `OperationProfile=outpaint`，并区分双模式：
  - **全身重构 `full_body`**：近景/头像默认。**禁止**「缩小脸硬贴 + 高 denoise 蒙版」。当前主路使用 EmptyLatent 保构图，并用 soft face IPAdapter 锁身份气质；按**全身竖图比例**重生成（标准约 `1024×1536` / 1.5，舒展约 `1024×1728` / 1.65，上限约 `1024×1792` / 1.75）；上半区无脸自动强构图重试；主图成立后再做脸部二次精修。身份权重不得重新把镜头拉回近景或把旧姿势拉回。
  - **原图续接 `extend`**：半身/全身已成立时按方向扩展；支持上/下/左/右/外扩，主体位置不动；走蒙版 inpaint + 像素回贴；默认 `denoise≈0.68`。近景补头请选向上，不要指望向下续接变全身。
  - 扩展方向/尺寸、模式、源图 recipe 写入 OperationProfile。
- `extend` 蒙版语义与局部编辑一致：**不透明=保护，透明=重绘**；网关 `canvas_prepare_inpaint_mask` + `ImageCompositeMasked`。
- full_body Outpaint 不得调用共享 Pose Adapter，也不得依赖旧 `pose_change:boolean`；需要直立或全身只通过 CompositionContext/PromptCompiler 表达，显式 PoseControlPlan 默认关闭。
- `full_body` 的身份和脸部精修参数由托管 OperationProfile 决定；不把节点手动 reference mode 覆盖托管策略。
- 默认继承源图实际 GenerationRecipe，而不是自动添加推荐 LoRA。
- 中文画面要求在提交前经文本模型整理为英文单语；失败时回落英文 fallback。
- 当前状态：历史上/下/左/右/外扩实现、专项测试与失败证据保留；产品能力尚未放行。Gate 0 的 C0-1~C0-Z 已完成（U1-R0 合同/schema/语义门已落盘，真实 manifest 未冻结）；下一步执行 U1-R0 归因、U1-R 回修与 U1-Z BOSS 终验。合同入口：`docs/u1-r0-execution-contract.md`。

#### D. 局部蒙版编辑

- 使用独立 `OperationProfile=inpaint`。
- 硬约束：用户 mask、未选区保护、目标区域 prompt、漂移检测。
- 默认继承源图 recipe；不自动使用节点 reference mode，不自动加载推荐 LoRA。
- denoise 以局部编辑面板的值为准；节点设置只能通过「继承高级设置」显式启用。

#### E. 角色部件工坊

- 使用 `CompositionPlan/EditPlan + WorkflowCapability` 路由，不直接消费节点 `comfyExtra`。
- CharacterProfile、PartDefinition、OutfitRecipe、CompositionContext 是语义输入；
  protected regions、risk level、route 是执行硬约束。
- 允许用户选择「偏好模型/质量档」，但不得绕过身份 gate、部位 mask、body_constraints 和漂移检查。

#### F. Exact Replay / 重试

- 重试必须回放产物记录的实际 workflow/model/LoRA/reference mode/seed/detailer/denoise。
- 「明确无 LoRA」与「配置未知」必须是两个状态；空数组也要持久化。
- 禁止因为重试产物没有 LoRA 字段就自动注入当前推荐 LoRA，否则不再是重试。

### 8.3 配置对象拆分

```text
ManualNodeSettings        # 节点自由配置
PromptComposition         # prompt/slots/context；无 workflow 参数
SourceGenerationRecipe    # 源图实际生成配方
OperationProfile          # outpaint/inpaint/atelier/pose-change 的托管参数
ExecutionPlan             # 合并后只读快照，记录每个字段来源
```

执行前 UI 必须展示关键字段来源，例如：

```text
model: SourceGenerationRecipe
loras: explicit-empty (source image)
reference_mode: OperationProfile(outpaint)
denoise: OperationProfile(outpaint)=false(full_body FaceID)/0.68(extend)
face_detailer: disabled by protected-face policy
```

当前落地状态：

- 图片生成产物持久化 `SourceGenerationRecipe`，其中 `loras: []` 表示明确裸跑，缺少 `loras` 才表示历史配方未知。
- 托管 Inpaint / Outpaint 生成 `OperationProfile + ExecutionPlan`；节点信息面板可查看模型、LoRA、参考模式、denoise、FaceDetailer 及字段来源。
- Exact Replay 使用产物配方和持久化蒙版，不再在 LoRA 为空时自动注入推荐 LoRA。
- 画面 Outpaint 支持全身重构与上/下/左/右/外扩原图续接：前端扩展画布并生成保护蒙版，网关通过蒙版 inpaint + 像素回贴锁定保护区域；中文需求提交前统一英文化。
- 待补：托管操作高级覆盖开关、漂移风险提示、Character Atelier 的 CompositionPlan/EditPlan 接入。

---

## 9. 产品设计

### 9.1 P1 主门面：拆解核对台

```
图片节点 ──拆解──▶ 拆解核对台
  ├─ 左：原图 + 图层叠加（点部位高亮，显示 quality_grade + reasons）
  ├─ 中：检测到的槽位列表（只列「实际可见」槽，不承诺满槽）
  ├─ 右：单区操作（精修蒙版 / 重打标 / 丢弃 cutout 只留 semantic / 批准升格）
  └─ 底：保存 Observations │ 升格 PartDefinition │ 导出拆解展板
```

- 展板只消费**已确认**区域；展板需求不绑架底层节奏。
- 完整「角色工坊节点」（槽位栏 + 部件库 + 组合生成）在 P3 随 Recipe 一起成型。

### 9.2 两条主流程

**流 A · 拆解入库**
图节点 → 一键拆解（Job）→ 核对台人工核对/精修 → Observation 落库 → 批准升格 PartDefinition →（可选）导出拆解展板

**流 B · 组合生成**
选 Profile + 槽位填充（PartRevision / 手写 semantic）+ CompositionContext → `/compositions/plan` 预览（路由/半径/保护区/降级原因）→ 确认执行 → 任务卡片跟踪 → face-refine + 漂移二次检查收尾

### 9.3 展板产品面

| 类型 | 对齐 | 实现 |
|---|---|---|
| 拆解展板 Deconstruct Board | BOSS 图一 | **P1 门面**；前端模板排版，消费已确认区域 |
| 风格提案板 Styling Board | BOSS 图二 | P3；Hero + 材质网格 + 参数条 + Look |

---

## 10. 评测与验收

一切阈值先建评测集再校准；未经验证的数字（如「30 秒出图」「每图 6 槽」）不写入验收。

### 10.1 固定评测集（P0A 建立）

30–50 张，覆盖：正面/侧面/坐姿/交叉腿、长发遮脸、连衣裙与上下装、透明/网格丝袜、鞋被裙摆遮挡、手持物/外套/配饰遮挡。**动漫与写实分开统计；R18 子集单独隔离与访问控制。**

评测工装：deepghs 生态整套复用——`dghs-imgutils`（CCIP 身份对比 / wd14 打标含 rating / 单角色抠像）+ `sdeval`（SD 出图量化评估框架），网关侧 pip 引入，不自造脚手架。

### 10.2 拆解验收（P1 出口）

- 只对「实际可见且已标注」的核心类别计算 precision/recall；核心槽识别 **macro F1 ≥ 0.85**（阈值经 P0A 校准后定稿）。
- mask IoU **按类别**统计 + **Boundary F-score**；透明/蕾丝类别单独报表。
- 自动结果免修改入库比例；单图人工修正中位时间。
- 错槽率 / 漏槽率 / 空槽误报率。
- 端到端 p50/p95 时延（分阶段）；OOM/失败率。

### 10.3 身份一致性验收（P2 出口）

- 固定 10–20 个角色 × 各三次连续替换。
- 身份指标**按域拆分**：写实域用 face embedding（ArcFace/FaceID 系）；**动漫域用 CCIP**（deepghs/imgutils，动漫角色同一性模型，`ccip_difference` 越小越同一，默认模型校准阈值 ≈0.178，各模型阈值见 deepghs/ccip_onnx）。真人脸 embedding 在动漫脸上不可靠，不得直接当动漫验收指标。CCIP 要求单角色图，计算前先过人物检测/抠像；跑在网关侧（pip `dghs-imgutils`），无需 Comfy 节点。
- 保护区 LPIPS/SSIM 距离 ≤ 阈值。
- 眼色/肤色/标志特征**人工盲评**：评审者不知道哪张来自新旧策略。
- 漂移超阈任务必须被自动拦截；**同时记录拦截召回率与误杀率**。

### 10.4 硬保护验收

- 输入 mask 快照存档 → 输出后保护区变化计算 → 容差判定（颜色/压缩/全局光照）。
- 超阈值任务必须进入 `awaiting_review` 或 `failed_protection_check`；face-refine 后不得跳过二次检查。

### 10.5 Recipe 回放验收

- Exact Replay：相同环境输出 hash 一致，或明确标注节点级不确定性。
- Semantic Regenerate：槽位语义 + 身份评分达标即可，不要求像素一致。
- 覆盖模型缺失 / workflow 升级 / part revision 变化时的提示行为。

### 10.6 可用性验收

图片→首个可编辑区域时间；修一个错误 mask 的操作数；部件入库完成率；用户能否区分 Observation 与 Part；任务取消生效时间；断线重连后任务恢复。

---

## 11. Gate F 域内验收分解

> 本节只定义 Character Atelier 的内部依赖与验收内容，不定义跨域排期。Gate 0–E 的顺序和状态以统一总控为准；只有总控激活 Gate F 后，才可执行本节未完成工作。

### P0A · 评测集与能力矩阵

- 建 30–50 张固定评测集（含 R18 隔离子集）。
- 比较 ClothesSegment / Segformer / SAM 组合策略（含 SegAnimeChara 式骨架→体积→SAM 补路）→ 校准 §10.2 阈值。
- 实测 Qwen Edit 是否支持硬区域约束 → 决定 §6.1 gate 结论。
- 测 FaceID / face-refine 前后身份变化基线（写实 face embedding + 动漫 CCIP）。
- 各 workflow p50/p95 + 显存峰值 → WorkflowCapability 矩阵。
- **VTON Spike**：家里 5060Ti 16GB 装 CatVTON 社区/相关 ComfyUI 节点冒烟（CatVTON 项目口径 <8GB 可跑，16GB 显存余量充足）；结论只影响 Reference schema 与 P4 计划，不阻塞主线。

### P0B · 域模型与任务协议

- SQLite schema（四实体 + Job + Capability）+ content-addressed 资产目录。
- MaskAsset / EditPlan / 漂移检测协议定稿。
- 异步 Job API 骨架 + 错误码 + Idempotency。
- workflow 注册表 + hash。

### P1 · 拆解核对台

- `/decompositions`：ClothesSegment 主路 + SAM3 补洞 + 多模型融合打标。
- 核对台 UI：只检测实际可见槽 → 人工核对/精修 → Observation 落库 → 批准升格 PartDefinition。
- 拆解展板导出（消费已确认区域）。
- **验收**：§10.2。

### P2A · 安全 R0 编辑

- 发色 / 局部材质 / 不改版型的 legwear 编辑（梯度蒙版 inpaint）。
- 输出漂移 gate + 一键回滚。
- Character Profile 自动建档。
- **验收**：§10.3 + §10.4。

### P2B · R1 单槽结构编辑

- 整裙、发型轮廓等大蒙版修改；Qwen Edit 若过 gate 则启用。
- R0 达标后才进入。

### P3 · Outfit 与暖暖感

- 版本化 Recipe（Exact Replay / Semantic Regenerate）+ 计划预览 + 串行任务卡片。
- accessories 多槽 + CompositionContext 对接场景模板/换姿管线。
- 部件库检索/收藏/重打标；风格提案板。
- 完整「角色工坊节点」成型。

### P4 · 换姿与跨图取件

- 换姿产品化（R3：旧观测作废 + 重新分割）。
- VTON 产品化（依据 P0A Spike 结论；CatVTON 非商用许可证限制内部使用）。
- 捏脸模式（反向蒙版：只开放脸区）。
- 可选多视图角色表增强 Profile。

**域内顺序**：Gate F 激活后，先确认角色基线并重筛 P0A 评测集；P0B 的未完成契约项依赖 Shared Generation Core 和前序 Gate 的已冻结能力。P0A、P0B 均满足各自入口后才能进入 P1，后续按 P2A → P2B → P3 → P4 推进。

---

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| 动漫分割不稳 | 服装 parsing 主路 + SAM3 补洞 + 人工核对台兜底（动漫域无拿来即用的部位 parsing） |
| 观测被当部件复用 | 四实体拆分 + 升格必须人工批准 + 换姿作废观测 |
| 多槽叠加崩图 | 破坏半径分级；>R2 任务卡片化 + staging 确认 |
| Qwen Edit 偷改脸/背景 | capability gate + 漂移检测拒收；过 gate 前只进实验模式 |
| 显存挤占 | 调度器 + VRAM 预算 + OOM 降级 + 单 GPU 串行 |
| 跨图风格不一致 | 记录 source preset；compose 统一底模/风格锚 |
| 脏库 | quality_grade 门槛 + needs_review + 升格审批 |
| 中间图连喷体验差 | 任务卡片折叠中间产物 + queue/cancel/history |
| 会话读图审查中断 | BOSS 看图；代理侧只读日志/结构化结果 |
| 许可证踩雷 | 能力矩阵记录 license（CatVTON/TryOffDiff 均非商用；InsightFace `buffalo_l` 仅限 non-commercial research use）；授权或替换前不得进入商用/对外主路 |
| 并发写坏元数据 | 第一天 SQLite（WAL+外键+软删除），无 JSON 过渡期 |

---

## 13. 可选增强（非阻塞）

1. 「只改材质不改版型」模式（同槽只换 palette/tags）。
2. 组合器反哺：场景模板 → 推荐槽位填充清单。
3. R18 protect_zones 通用化（下体重绘默认开启）。
4. 多候选生成 + 自动 rerank（DINO/CLIP/CCIP/face embedding 质量门）后再给 BOSS 挑。

---

## 14. 远期方向：确定性部件重组

「游戏级确定性换装」需要结构化分层资产，diffusion 局部编辑只能模拟效果。当前学术前沿：

- **See-through**（arXiv 2602.03749，SIGGRAPH 2026 conditionally accepted，已开源）：单张动漫立绘 → 全补全（fully inpainted）语义分层 + 推导绘制顺序，输出**分层 PSD**（19 语义部位 + depth + mask），目标 Live2D 方向；数据引擎用 GradCAM 弱监督 + SAM 先验 + Live2D 渲染引擎传播标签。社区已有 webui 与自动绑骨工具生态。
- 作者自评边界：离全自动 Image-to-Live2D 还很远（缺 rigging、缺整体艺术意图），定位是消除手工分割和遮挡补全两个最繁琐环节。
- 立项条件成熟时，先在 Windows 侧 Spike See-through：其分层 PSD 可直接喂展板/部件库。在此之前，本项目定位保持「受控局部编辑 + 部件灵感库」。

---

## 15. 外部调研证据索引（2026-07-13 两轮核验）

| 主题 | 来源 | 对本设计的影响 |
|---|---|---|
| 动漫分层拆解 | See-through, arXiv 2602.03749（SIGGRAPH 2026） | §5.1 SAM 定位、§3.5 hair_front/back、§14 远期路线 |
| 动漫域差 | Body Part Segmentation of Anime Characters（CAVW 2024，Wiley，原文已核验） | §5.1 主路选择 |
| 动漫分割生态 | AniSeg / SkyTNT anime-segmentation / CartoonSegmentation（均整角色级，含 comfyui_animeseg 节点包） | §5.1 部位 parsing 缺口证实、前置抠像 |
| 骨架推导部位 | SegAnimeChara（SIGGRAPH 2023 Posters，OpenPose→BodyPix 体积→SAM） | §4.3 crotch 推导、§11 P0A 对比项 |
| VTON 轻量化 | CatVTON, arXiv 2407.15886（ICLR 2025）：bf16 1024×768 <8G、社区/相关 ComfyUI 节点、CC BY-NC-SA | §11 P0A Spike、§6.1 license 字段 |
| VTON 动漫背书 | OmniVTON++, arXiv 2602.14552（training-free，明确支持 anime try-on） | §6.2 路由 C 可行性 |
| VTOFF 单品清洗 | TryOffDiff, arXiv 2411.18350（BMVC 2025，SSPL 非商用） | §3.4 Reference 态 canonical garment image 预留 |
| VTON 对比勘误 | OOTDiffusion, arXiv 2403.01779：DressCode 训练线覆盖上/下装与连衣裙 | 排除理由 = 本机未部署 + 无动漫域证据（非「不支持下装」） |
| 梯度蒙版 | Differential Diffusion, arXiv 2306.00950（ComfyUI 原生支持） | §4.1 mask_mode、§6.3 R0 默认 |
| 双蒙版/上下文 | Krita AI Diffusion（GitHub 8.7k★）：Selection Feather/Blend 双蒙版、Selection Padding/Bounds | §4.2 EditPlan 双蒙版 + context_mode |
| 任务卡片交互 | Krita queue+cancel+history；InvokeAI staging area | §6.3 / §7 任务协议与 UI |
| 区域软约束边界 | Attention Couple / Regional prompting 社区共识 | §4.4 软辅助不进硬保护 |
| 动漫身份指标 | CCIP（deepghs/imgutils，`ccip_difference`，默认模型阈值 ≈0.178@ccip_onnx） | §10.3 动漫域验收 |
| 评测工装 | deepghs `sdeval` + `dghs-imgutils`（wd14/抠像/CCIP） | §10.1 评测脚手架 |
| 梯度蒙版节点核验 | 本机 Comfy `object_info`（2026-07-13）：DifferentialDiffusion 等 8 节点在位 | §2.3 / §4.1 零安装确认 |

完整调研笔记：`infinite-canvas/docs/character-atelier-research-notes.md`

---

## 16. 域内决策记录

> 以下决策约束 Gate F 内部实现，不授权提前启动；跨域排期以统一总控为准。执行状态见《character-atelier-dev-checklist.md》。

1. **域内入口**：P0A 评测集须在角色基线固定且 Gate F 激活后重筛；P0B 未完成项须复用已冻结的 Shared Generation Core。两者通过各自入口后才能进入 P1。
2. **存储落点**：✅ 部件库/SQLite 落在网关侧 `Mission_manager/data/atelier/`；Mac 端只留缓存不留主库。
3. **P2A 首批槽位**：✅ legwear / bottom / dress / hair_front+hair_back（canonical 槽，UI 聚合成「下装/连衣裙」「头发」两个入口）。
4. **身材/胸型**：✅ 按 `Profile.body_constraints` 处理（默认锁定、独立风险等级），不做可换槽。
5. **VTON Spike 硬件**：✅ 直接用家里 5060Ti **16GB**（此前文档误记 8GB，已修正；CatVTON 官方口径 <8GB 即可跑，16GB 余量充足），先跑通流程验证，不等 Windows 主力机。
6. **评测集来源**：✅ 由囡囡从历史生成里筛 30–50 张标注样本初版（含 R18 隔离子集），交 BOSS 过目定稿。

---

## 17. 文档与证据索引

| 项 | 路径/事实 |
|---|---|
| 本设计文档 | `infinite-canvas/docs/character-atelier-design.md`（v0.4） |
| **开发清单（域内状态与验收索引）** | `infinite-canvas/docs/character-atelier-dev-checklist.md`（P0A→P4 条目 + 状态；不定义跨域排期） |
| 独立评审记录 | `infinite-canvas/docs/character-atelier-review-sol.md`（gpt-5.6-sol，对 v0.2 的评审；其 P0/P1/P2 意见已全部融入本版） |
| 外部调研笔记 | `infinite-canvas/docs/character-atelier-research-notes.md`（2026-07-13 两轮核验） |
| v0.2 备份 | `/tmp/character-atelier-design-v02-backup.md` |
| 画布切图 | `web/src/components/canvas/canvas-node-split-dialog.tsx` |
| 蒙版编辑 | `web/src/components/canvas/canvas-node-mask-edit-dialog.tsx` |
| 裁剪 | `web/src/components/canvas/canvas-node-crop-dialog.tsx` |
| 提示词组合器 | `web/src/components/canvas/canvas-prompt-library.tsx`（v15.6） |
| 智能组合 | `web/src/lib/canvas/smart-compose-prompt.ts` |
| 网关 | `Mission_manager/scripts/local-agent/llama_ui_gateway.py`（v14.3） |
| 模型注册 | `Mission_manager/scripts/local-image/model-registry.json` |
| 分割冒烟产物 | Comfy output `atelier_smoke_mask_00001_.png` / `atelier_smoke_cutout_00001_.png` |
