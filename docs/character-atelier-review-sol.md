# 角色部件工坊 v0.2 · 独立评审（Sol / gpt-5.6-sol）

> 评审时间：2026-07-13 · 评审对象：`character-atelier-design.md` v0.2
> 调用方式：本地 CPA 网关直连 `gpt-5.6-sol`（流式）
> Verdict：**MAJOR_REWORK**（方向认可，核心契约需先修）

---

# Sol 独立设计评审结论

## 1. 总评

### 结论

**当前不建议直接进入 P1 功能开发。可以开工，但仅限于契约重构、基准集验证和技术 Spike。**

**最终 Verdict：`MAJOR_REWORK`**

文档的产品方向、硬保护原则、分期意识基本正确，也充分利用了现有底座；但当前设计仍把三件本质不同的东西混在一起：

1. 从单张图中提取出的**观测结果**
2. 可复用的**部件定义**
3. 能稳定重放的**生成配方**

如果不先拆开，后续会快速出现脏库、槽位语义不一致、换姿后蒙版失效、同名部件无法复用、Outfit 无法真实回放等问题。

### 最大风险

最大风险不是“分割不准”，而是以下错误假设：

> **从一张扁平角色图切出的 mask/cutout，可以自然升级为可跨姿势、跨角色、跨构图复用的暖暖式部件。**

实际上，单图拆解只能得到当前视角下的局部像素观测，存在：

- 遮挡区域缺失
- 头发、皮肤、衣服边界粘连
- 正反面信息缺失
- 姿势绑定
- 光照、透视、画风和身体形态绑定
- 连衣裙、外套、长发等跨多个身体区域
- 换姿后原 mask、bbox、cutout 全部失效

因此，近期可兑现的产品应明确为：

> **语义驱动的受控局部编辑 + 部件灵感库**

而不是立即承诺：

> **像游戏资源一样确定性拆件并任意重组**

---

# 2. 做对了什么

## 2.1 把“硬保护优先”定义成系统不变式

这是全文最正确的技术判断。身份保护、胯下保护、非编辑区域保护都不能只靠 prompt。尤其已有局部重绘和换姿翻车经验时，继续依赖软提示词会重复失败。

## 2.2 没有把 VTON 强塞进近期关键路径

本地没有 CatVTON/IDM-VTON，且 VTON 对动漫角色、非标准姿势、夸张服装、丝袜等类别未必稳定。把跨图取件延后是合理的产品降维。

## 2.3 破坏半径与任务卡片方向正确

局部材质修改、整件结构修改、换姿、跨图取衣的风险等级明显不同。超过一定范围后暴露中间结果、支持取消和回滚，比黑盒串行生成更符合工程实际。

## 2.4 保留人工蒙版回环

自动分割不可能覆盖长发遮脸、透明丝袜、蕾丝、荷叶边、手持物遮挡等复杂情况。复用现有蒙版编辑器是正确选择，不应另造编辑器。

## 2.5 将 Profile、Outfit、来源溯源纳入设计

这说明方案不只考虑一次生成，也开始考虑角色身份、配方回放和资产管理。方向正确，但目前字段和回放契约还不够。

---

# 3. 问题与漏洞

## P0：阻断问题

### P0-1：`Part` 同时承担提取结果、可复用部件和生成指令，领域模型不成立

**问题**

现有 schema 中，一个 `part` 同时包含：

- 当前原图上的 mask/cutout/bbox
- 语义 tags/prompt
- 可选 garment reference
- 槽位和兼容信息

这三类数据生命周期完全不同。当前图片上的“裙子区域”不等于可复用的“裙子部件”，更不等于“生成一条同款裙子的配方”。

**为何重要**

如果按现有模型入库：

- 同一件衣服在不同图中会产生多个不可归并的 part
- 换姿后 visual 数据失效，但系统仍会认为该部件可用
- dirty cutout 与 semantic 可能描述不同内容
- 人工改标签后无法判断是修改提取结果还是修改全局部件定义
- Outfit 引用 `part_id` 也无法保证未来回放结果一致

**改法**

至少拆成四类实体：

1. `Extraction`：一次图片拆解任务
2. `RegionObservation`：某张图上的 mask、bbox、cutout、置信度
3. `PartDefinition`：用户认可的可复用语义部件
4. `PartRevision`：部件语义、参考图、兼容规则的版本

推荐关系：

```text
SourceImage
  └─ Extraction
      └─ RegionObservation
          └─ promote/link → PartDefinition@revision
```

Outfit Recipe 必须引用明确的 `PartDefinition revision`，不能只引用浮动的 `part_id`。

---

### P0-2：蒙版和保护区缺少可执行的坐标、合成与验证契约

**问题**

文档提出“脸区物理挖掉”和“胯下保护挖空”，但 schema/API 没有定义：

- mask 对应哪一版源图
- 宽高、色彩空间、alpha 语义
- 白色是编辑区还是保护区
- bbox 是像素坐标还是归一化坐标
- 图片裁剪、缩放、旋转后如何变换
- 多个 mask 重叠时如何求并集/差集
- 羽化、膨胀、腐蚀参数
- 换姿后旧保护区如何作废
- 生成结果如何验证保护区确实没有漂移

**为何重要**

“硬保护”如果没有形式化契约，只是文档口号。Qwen Edit、普通 inpaint、face-refine 对 mask 的支持程度也不同；特别是 face-refine 本身可能在最后再次改变已保护的脸。

**改法**

建立统一 `MaskAsset` 和 `EditPlan`：

```jsonc
{
  "mask_asset_id": "asset-mask-xxx",
  "source_image_revision": "sha256:...",
  "width": 1024,
  "height": 1536,
  "coordinate_space": "source_pixel",
  "semantics": "editable_white",
  "threshold": 0.5,
  "feather_px": 8,
  "dilate_px": 4,
  "regions": ["legwear"],
  "derived_from": {
    "workflow_id": "segment-clothes-v3",
    "model_versions": {}
  }
}
```

执行前生成：

```text
effective_edit_mask
= requested_region
- face_protect
- crotch_protect
- user_protect
- other_locked_regions
```

执行后必须做 protected-region drift 检测；超过阈值则自动标记失败、回滚或要求人工确认。

R18 胯下保护区应由 body parsing/keypoints 推导，并允许用户编辑；不能使用固定几何框。

---

### P0-3：API 不是可实现的契约，缺少异步任务语义

**问题**

目前只列出了 `/decompose`、`/compose` 和 CRUD 名称。生图和分割是长任务，但没有定义：

- 同步还是异步
- 任务状态机
- 进度与中间产物
- 取消语义
- 重试与幂等
- 错误码
- ComfyUI prompt/job ID 映射
- 资源上传下载
- 并发冲突
- 客户端断线恢复
- 版本冲突
- workflow 不可用时的降级

**为何重要**

任务卡片、取消、回放、禁止并行都依赖任务协议。没有这层，前端和网关会分别发明状态机，最后无法可靠恢复。

**改法**

采用异步 Job API：

```http
POST /api/v1/decompositions
POST /api/v1/compositions
GET  /api/v1/jobs/{job_id}
POST /api/v1/jobs/{job_id}/cancel
GET  /api/v1/jobs/{job_id}/events
```

创建接口返回 `202 Accepted`：

```json
{
  "job_id": "job-xxx",
  "status": "queued",
  "plan": {
    "route": "inpaint",
    "risk_level": "R1",
    "protected_regions": ["face", "crotch"]
  }
}
```

状态至少包含：

```text
queued → validating → running → awaiting_review
       → succeeded / failed / cancelled
```

同时增加：

- `Idempotency-Key`
- `schema_version`
- `expected_revision`
- 标准化错误码
- 任务中间产物列表
- Comfy workflow/version/hash
- 模型能力检测接口
- `dry_run` 计划预览

---

### P0-4：验收标准无法判定是否成功

**问题**

“≥6 核心槽”“脸不漂”“BOSS 目视”“≤30s 级”都不是完整可测标准。

例如一张图未必存在鞋、丝袜或独立上衣；系统输出六个空槽也可能形式上通过。脸是否漂移也没有基线、阈值和失败样例。

**为何重要**

无法验收就无法比较 ClothesSegment、SegFormer、SAM3，也无法判断 face-refine 是改善还是破坏身份。

**改法**

开工前建立固定评测集，至少覆盖：

- 正面/侧面/坐姿/交叉腿
- 长发遮脸
- 连衣裙与上下装
- 透明或网格丝袜
- 鞋被裙摆遮挡
- 手持物、外套、配饰遮挡
- 动漫与写实至少分别统计
- R18 测试集单独隔离和访问控制

验收必须包含自动指标和人工盲评，详见第 8 节。

---

### P0-5：P1 槽位 `bottom_or_dress` 与目标槽位模型冲突

**问题**

完整模型使用 `top`、`bottom`、`dress` 和互斥组；P1 却把 `bottom_or_dress` 作为持久槽位。后续无法无损迁移：

- 不知道该记录属于 bottom 还是 dress
- 无法表达 dress 与 top/bottom 的覆盖关系
- 组合器可能生成互相冲突的 prompt
- 已保存 Outfit 需要批量迁移

**为何重要**

槽位枚举是持久化和 API 的基础，一旦数据入库，后改成本很高。

**改法**

持久化层从第一天就使用 canonical slot：

```text
top
bottom
dress
```

UI 可以在 P1 显示一个聚合入口“下装/连衣裙”，但不能把聚合 UI 名称写入领域模型。

---

## P1：重要问题

### P1-1：`confidence` 没有来源和校准方式

**问题**

ClothesSegment、SAM、caption 模型输出的分数含义不同，不能直接压成一个 0–1 值。

**为何重要**

未经校准的 0.86 会给用户造成错误信任，也无法制定自动入库阈值。

**改法**

拆分为：

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

只有基于标注集校准后，才能生成面向用户的综合置信等级。

---

### P1-2：层模型只有 `base/mid/outer/accessory`，不足以处理遮挡

**问题**

衣服层级不是全局单值。长发可能在脸前、肩后；外套可能覆盖 top 但不覆盖 bottom；丝袜在皮肤上、鞋下；裙摆会覆盖腿部但不覆盖鞋尖。

**为何重要**

简单 layer 字符串无法支持实际冲突检测和编辑范围计算。

**改法**

增加区域化覆盖关系：

```jsonc
{
  "slot": "dress",
  "occupies": ["torso", "pelvis", "upper_legs"],
  "occludes": ["top", "bottom", "legwear"],
  "may_coexist_with": ["outerwear", "shoes"],
  "z_order_by_region": {
    "torso": 30,
    "legs": 20
  }
}
```

冲突规则应由版本化规则表维护，不要散落在前端。

---

### P1-3：Pose 不应作为普通部件槽

**问题**

Pose 会改变所有空间资产、遮挡关系和身体轮廓。它不是和鞋、发型同等级的部件。

**为何重要**

一旦换姿，原图上的 mask/bbox/cutout 全部失效，Outfit 的执行顺序也会改变。

**改法**

把 `pose` 从 wearable slot 中移出，改成 `CompositionContext`：

```text
Character/Profile
+ Outfit
+ Pose/Camera/Scene Context
→ Composition Plan
```

换姿后必须重新分割或重新生成区域，不得沿用旧 spatial observation。

---

### P1-4：Qwen Edit 路由缺乏安全边界

**问题**

文档将整件结构大改交给 Qwen Edit，但没有证明其能够严格遵守局部 mask，也没有输出漂移检测。

**为何重要**

全图编辑模型最容易改脸、改身材、改背景。它与“硬保护优先”可能直接冲突。

**改法**

路由器必须根据 capability matrix 选择模型：

```text
supports_mask
supports_reference
supports_identity_adapter
supports_pose_control
supports_seed
supports_region_lock
```

若 Qwen 路由不能提供硬区域锁：

- 只能进入实验/建议模式
- 输出必须做 face/protected-region gate
- 漂移超阈值自动拒收
- 不得作为 R1 默认生产路由

---

### P1-5：Character Profile 太薄，无法支撑身份锁

**问题**

仅有参考图、identity prompt 和 banned terms，不足以定义身份。

**为何重要**

身份不仅是脸，还包括发际线、瞳色、体型、肤色、标志物；而头发本身又可能是可换槽，与 identity prompt 冲突。

**改法**

将身份分成：

- `immutable_identity`：脸型、眼睛、肤色等
- `default_appearance`：默认发型、妆容
- `body_constraints`：体型和比例
- `mutable_traits`：允许被槽位覆盖的属性
- `reference_embeddings`：模型、版本和 embedding hash
- `protected_regions_policy`
- `identity_revision`

不要把默认发型永久写入不可变 identity。

---

### P1-6：Outfit Recipe 不能保证回放

**问题**

“槽位快照 + 参数 + 底模”不够。模型、LoRA、ControlNet、workflow、sampler 或节点版本变化都会改变结果。

**为何重要**

“一键回放”如果只是重新随机生成，不应称为回放。

**改法**

定义两个概念：

1. **Exact Replay**：固定 workflow、模型 hash、seed、输入资产 revision
2. **Semantic Regenerate**：按语义重新生成相似结果

Recipe 至少保存：

- 每个部件 revision
- 输入图 hash
- workflow ID/version/hash
- 模型与 LoRA hash
- seed、sampler、scheduler、steps、CFG
- mask revision
- prompt 编译结果
- protect policy version
- route plan
- 输出资产 ID

---

### P1-7：JSON 索引“后迁 SQLite”风险过高

**问题**

部件、Profile、Outfit、Job 会被多任务并发更新。JSON 索引缺少事务、唯一性约束和版本冲突控制。

**为何重要**

取消任务、重复入库、人工重打标、删除源图时很容易破坏引用。

**改法**

从第一版就使用 SQLite：

- 元数据、关系、状态存 SQLite
- 图片/mask 使用 content-addressed filesystem
- 数据库只存 asset ID/hash/path
- 开启 WAL
- 使用外键和软删除
- schema migration 正式版本化

这是本地单机系统最合适的复杂度，不值得先造 JSON 临时债务。

---

### P1-8：显存策略过于粗糙

**问题**

“强制 PurgeVRAM + 禁止并行”可避免部分 OOM，但没有显存预算、任务调度和失败恢复。

**为何重要**

SAM3、Qwen Edit、FaceID 等模型切换可能造成高延迟；强制 purge 也可能让目标 30 秒不可达。

**改法**

增加资源调度器：

- workflow 预估 VRAM
- 单 GPU 队列
- 模型驻留策略
- OOM 自动降级
- 分辨率上限
- GPU 状态和 Comfy 健康检查
- p50/p95 分阶段计时，而非只看总时长

---

### P1-9：敏感资产缺少本地安全与生命周期设计

**问题**

R18 场景只讨论了胯下 mask，没有讨论资产存储、日志、缩略图、缓存、导出和删除。

**为何重要**

即使是纯本地系统，mask、cutout、Comfy 输出和任务日志都会形成多份敏感副本。

**改法**

至少定义：

- 默认仅局域网监听或 token 鉴权
- 不在日志记录原始图片/base64
- 敏感缩略图可关闭
- 删除 source 时级联或提示关联资产
- 临时文件 TTL
- 导出和共享显式确认
- 敏感评测集隔离

---

## P2：建议问题

### P2-1：P1 同时做拆解、入库、工坊、展板，范围仍偏大

**改法**

先交付“拆解核对台”，验证拆解和精修闭环；展板只消费已确认区域，不应反过来绑架底层节奏。

### P2-2：DeepDanbooru 不宜作为 semantic 主来源

它更适合全图标签，对具体部件的材质、版型和边界描述可能噪声较大。

**改法**

采用区域裁剪后的多模型融合：

- parsing 模型给类别
- Florence/Qwen-VL 类模型给部件描述
- DeepDanbooru 只补风格/动漫标签
- 用户确认后才升格为 PartDefinition

### P2-3：颜色 palette 需要定义算法和适用条件

透明丝袜、阴影、肤色透出时，简单聚类会把皮肤颜色当成服装色。

**改法**

记录 palette 提取算法和 mask erode 参数；对透明材质标记 `palette_unreliable`。

### P2-4：`expression` 不应长期并入 `face`

表情编辑和身份编辑的风险完全不同。建议第一版 UI 可以合并，持久化模型应独立。

---

# 4. 对 schema 的具体修改建议

## 4.1 推荐实体

```text
Asset
SourceImage
Extraction
RegionObservation
PartDefinition
PartRevision
CharacterProfile
OutfitRecipe
CompositionPlan
Job
WorkflowCapability
```

## 4.2 `RegionObservation` 示例

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
  "scores": {
    "class": 0.91,
    "boundary": 0.63
  },
  "review_status": "needs_review",
  "workflow": {
    "id": "clothes-segment-v1",
    "hash": "sha256:..."
  }
}
```

## 4.3 `PartRevision` 示例

```jsonc
{
  "id": "partrev-xxx",
  "part_id": "part-xxx",
  "revision": 3,
  "canonical_slot": "legwear",
  "semantic": {
    "concepts": ["fishnet", "glitter", "thigh_high"],
    "prompt_en": "...",
    "negative_prompt": ["solid opaque stockings"]
  },
  "compatibility": {
    "occupies": ["legs"],
    "occludes": ["skin_legs"],
    "conflicts_with": [],
    "requires": ["body_base"]
  },
  "reference_asset_ids": ["asset-ref-xxx"],
  "source_observation_ids": ["obs-xxx"],
  "status": "approved"
}
```

## 4.4 必加字段

- `schema_version`
- `revision`
- `content_hash`
- `source_image_revision`
- `model/workflow version`
- `review_status`
- `visibility_ratio`
- `occluded`
- `coordinate_space`
- `mask_semantics`
- `negative_prompt`
- `quality_reasons`
- `created_by`
- `deleted_at`

---

# 5. 对槽位模型的具体修改建议

## 5.1 持久化槽位与 UI 分组分离

建议 canonical slots：

```text
body
face_identity
expression
hair_front
hair_back
top
bottom
dress
outerwear
legwear
shoes
head_accessory
face_accessory
neck_accessory
hand_accessory
held_item
background
```

不要求 P1 全部展示，但数据层不要使用 `bottom_or_dress` 这类临时枚举。

## 5.2 把姿势和镜头移出槽位

新增：

```text
PoseContext
CameraContext
SceneContext
```

## 5.3 互斥规则不要只靠 `exclusive_group`

至少支持：

- `conflicts_with`
- `requires`
- `covers`
- `occludes`
- `allowed_regions`
- `z_order_by_region`
- `conditional_rules`

例如 dress 通常与 top/bottom 冲突，但某些吊带裙可以与内搭 top 共存，不能写死为全局互斥。

## 5.4 身体形态单独建模

胸型、体型、身高比例不是普通衣服槽，也不建议混入只读 body mask。应作为 Profile 下的 `body_constraints`，需要独立风险等级和保护策略。

---

# 6. 对分期的修改建议

## P0A：基准与能力矩阵，3–5 天

- 建立 30–50 张固定评测集
- 比较 ClothesSegment、SegFormer、SAM、组合策略
- 验证 Qwen Edit 是否真的支持硬区域约束
- 测量 FaceID/face-refine 前后身份变化
- 测量各 workflow 的 p50/p95、显存峰值
- 形成 workflow capability matrix

原定 0.5 天无法完成可信契约定稿。

## P0B：领域模型与任务协议

- SQLite schema
- Asset/Observation/Part/Recipe 拆分
- Job 状态机
- mask 坐标和保护区协议
- workflow/version/hash 规范

## P1：拆解核对台

只承诺：

- 对“图中实际存在”的目标槽进行检测
- 手工修正
- 保存 RegionObservation
- 人工批准后升格为 PartDefinition
- 导出基于已确认区域的展板

不要承诺每张图必有六个槽。

## P2A：安全 R0 编辑

先做：

- 发色
- 局部材质
- 不改变服装版型的 legwear 编辑

必须有输出漂移 gate 和一键回滚。

## P2B：R1 单槽结构编辑

再做整裙、发型轮廓等大蒙版修改。只有 R0 达标后才进入。

## P3：Outfit 与多步骤计划

实现版本化 Recipe、计划预览、串行任务和中间确认。

## P4：换姿与跨图取件

VTON 的产品交付可以延后，但建议在 P0 做技术 Spike，因为其输入资产要求会影响 Reference schema。

---

# 7. 对 API 设计的具体建议

建议最小 API：

```http
POST   /api/v1/assets
GET    /api/v1/assets/{id}

POST   /api/v1/decompositions
GET    /api/v1/decompositions/{id}
POST   /api/v1/decompositions/{id}/regions/{region_id}/review

GET    /api/v1/parts
POST   /api/v1/parts
PATCH  /api/v1/parts/{id}
POST   /api/v1/parts/{id}/revisions

POST   /api/v1/compositions/plan
POST   /api/v1/compositions
GET    /api/v1/compositions/{id}

GET    /api/v1/jobs/{id}
GET    /api/v1/jobs/{id}/events
POST   /api/v1/jobs/{id}/cancel

GET    /api/v1/capabilities
GET    /api/v1/health/comfyui
```

关键要求：

- 二进制资产只通过 asset ID 引用，不在 JSON 中传本机路径
- `plan` 与 `execute` 分离
- API 返回实际选中的 route、保护区和降级原因
- 编辑操作携带 `expected_revision`
- 创建任务支持 `Idempotency-Key`
- 取消应说明是“停止排队”还是“请求中断当前 Comfy prompt”
- Comfy workflow 使用注册表和 hash，不允许网关散落动态拼节点
- 失败必须区分：输入错误、能力缺失、OOM、Comfy 离线、保护区漂移、人工拒收

---

# 8. 验收标准评审与补充

## 8.1 P1 拆解验收

不能使用“每张图 ≥6 槽”。建议改为：

- 对测试集中**实际可见且已标注**的核心类别计算 precision/recall
- 核心槽识别 macro F1 达到约定阈值，例如 ≥0.85
- mask IoU 按类别统计，而不是只报平均值
- 同时统计 Boundary F-score，透明/蕾丝类别单独报表
- 自动结果无需修改即可入库的比例
- 单图人工修正中位时间
- 错槽率、漏槽率、空槽误报率
- 端到端 p50/p95 时延
- OOM/任务失败率

首版阈值可以在 Spike 后确定，不能先写一个未经验证的 30 秒。

## 8.2 P2 身份一致性验收

“三连替换 BOSS 目视”应补为：

- 固定 10–20 个角色，每个执行三次连续替换
- Face embedding 相似度相对原图不低于校准阈值
- protected face region 的 LPIPS/SSIM 或特征距离不超阈值
- 眼色、肤色、标志性特征采用人工盲评
- 评审者不知道哪张是原策略、哪张是新策略
- 漂移超过阈值的任务必须被系统自动拦截
- 自动拦截召回率和误杀率都要记录

单纯 face cosine 不够，需要与人工盲评联合。

## 8.3 硬保护验收

针对脸区和胯下保护区：

- 输入 mask 可视化快照必须保存
- 输出后计算保护区变化
- 设定允许的颜色/压缩/全局光照容差
- 超阈值任务进入 `awaiting_review` 或 `failed_protection_check`
- 不能在 face-refine 后跳过二次检查

## 8.4 Recipe 回放验收

区分：

- **Exact Replay**：相同环境下输出 hash 一致，或明确说明节点不确定性
- **Semantic Regenerate**：槽位语义和身份评分达标，不要求像素一致

同时测试模型缺失、workflow 升级和 part revision 变化时的提示行为。

## 8.5 可用性验收

至少记录：

- 从图片到首个可编辑区域的时间
- 修正一个错误 mask 所需操作数
- 部件入库完成率
- 用户是否能理解 Observation 与可复用 Part 的区别
- 任务取消生效时间
- 断线重连后任务是否恢复

---

# 9. 遗漏的技术路线与参考

## 9.1 可补充的技术路线

### 分割与语义定位

- GroundingDINO/Florence phrase grounding + SAM
- SCHP、LIP、ATR 等 human parsing 路线
- 针对动漫数据微调的 human parsing，而非只依赖通用服装模型
- 对头发前后层、透明材质建立专门后处理

### 结构与一致性控制

- DensePose、Depth、Lineart/SoftEdge ControlNet
- Differential Diffusion / 区域条件控制
- Regional Prompting
- 输出后 DINO/CLIP/Face embedding 自动质量门
- 多候选生成后自动 rerank，而不是单张直接接受

### 资产化路线

如果长期目标真是“暖暖式确定性换装”，应调研：

- 多视图角色表
- 2D 分层 PSD/Live2D 式资产
- 3D/SMPL/DensePose 中间表示
- 服装模板或参数化部件，而不只是 diffusion prompt

游戏式换装本质是结构化资产系统，生成式编辑只能模拟效果，不能默认等价。

## 9.2 VTON 参考

可比较：

- CatVTON
- IDM-VTON
- OOTDiffusion
- StableVITON
- OutfitAnyone 类路线

评估时重点不是只看“能不能穿上”，而是：

- 动漫支持
- 非正面姿势
- 角色脸和体型保持
- 长裙/丝袜/配饰
- 本地显存
- 模型许可证
- garment reference 的输入清洗要求

## 9.3 产品参考

- Photoshop Generative Fill：局部编辑与保护区交互
- Krita AI Diffusion：蒙版、ControlNet、区域工作流
- InvokeAI Canvas：分阶段生成和中间结果管理
- ComfyUI 工作流模板：能力注册和版本管理
- Live2D/游戏纸娃娃系统：层级、遮挡、互斥和确定性资产模型

---

# 10. 最终 Verdict

## `MAJOR_REWORK`

原因不是方向错误，而是**核心契约尚未达到可持续实现的程度**。

允许立即开始的工作：

- 评测集
- 分割/编辑能力 Spike
- SQLite 和资产协议
- Job API
- mask/protect contract
- 领域模型重构

不建议立即开始的工作：

- 按现有 `part` schema 大量入库
- 使用 `bottom_or_dress` 作为持久槽位
- 直接做 Outfit 回放
- 将 Qwen Edit 作为默认 R1 路由
- 对外承诺“任意部件自由重组”

完成 P0 修订后，项目可以升级为 `APPROVE_WITH_CHANGES` 并进入拆解核对台开发。

---

# 11. Top 5 开工前必须改的点

1. **拆分领域实体**  
   将 `RegionObservation`、`PartDefinition/Revision`、`Outfit Recipe` 分开，禁止一个 `part` 同时代表像素切片和可复用部件。

2. **定稿 mask/protect 契约**  
   明确坐标、图像 revision、mask 语义、变换、膨胀/羽化、合成顺序，以及生成后的保护区漂移检测。

3. **把 API 改成异步 Job 协议**  
   补齐状态机、进度、取消、幂等、错误码、中间产物、断线恢复和 Comfy workflow 版本映射。

4. **修正槽位模型**  
   持久化层从第一天使用 `top/bottom/dress` canonical slots；pose 移到 Composition Context；增加区域覆盖和遮挡规则。

5. **建立固定评测集与量化验收**  
   用 mask IoU/Boundary F-score、身份相似度、保护区漂移、人工修正时间、p50/p95、失败率替代“BOSS 目视”和“≥6 槽”。