# 角色部件工坊 · 开发清单（Dev Checklist）

> 配套设计文档：`character-atelier-design.md` v0.4。
> 跨域总控：`infinite-canvas-unified-development-plan.md`。
> 本文件是 **Character Atelier 域内状态与验收索引**，不单独定义排期。仅当总控激活 Gate F 后，才可执行未完成条目；每个条目只在实际验证通过后才改状态，禁止「写完代码就打勾」。

## 状态图例

| 标记 | 含义 |
|---|---|
| ⬜ 未开始 | 还没动工 |
| 🟨 进行中 | 有代码/产物但未过验收 |
| ✅ 已完成 | 有可复现证据（命令/截图/评测数字）且过验收口径 |
| ⛔ 阻塞 | 依赖未就绪或有外部阻断，备注写明原因 |
| 🧪 实验 | Spike/验证性质，结论落盘即算完成 |
| ❌ 已作废 | 产物或结论失效，不再作为验收依据 |

## 已拍板域内约束

- 排期：仅服从统一总控；Gate F 激活前，本清单不授权启动 Atelier 新阶段。
- 存储：网关侧 `Mission_manager/data/atelier/`（SQLite WAL + content-addressed assets）。
- P2A 首批槽位：legwear / bottom / dress / hair_front+hair_back。
- 身材/胸型：`Profile.body_constraints`，默认锁定，不做可换槽。
- VTON Spike：家里 5060Ti **16GB** 直接跑（CatVTON 官方口径 <8GB 可跑）。
- 评测集：从历史生成筛 30–50 张初版 → BOSS 过目定稿。旧定稿已因角色形象未固定而作废，Gate F 激活后重筛。

---

## 当前域状态（Gate F 阻塞）

- **P0A 评测集定稿作废**：角色形象尚未固定，原 34 张评测集失效（A1 改 ❌、A3 转 ⛔）；atelier.db 中 34 行 source_images 与已入库资产先留档不删，重筛时再决定清理或复用（删除需 BOSS 确认）。
- **跨域前置未完成**：Gate 0 已 DONE；Gate A 进入 U1-R0（真实 `manifest.json` 已 FROZEN，18 cells 尚未提交）。历史代码回归、U1-A 五方向结果和 U1-QA 工具只作证据保留。X5 继续保持 🟨，不得把历史矩阵当成产品已通过。
- **启动条件**：只有统一总控按顺序完成 Gate A–E 并激活 Gate F 后，才重筛 P0A 评测集并按本清单推进域内验收；本文件不建立平行入口。
- **保留复用（不作废）**：A2 R18 隔离机制、A4 评测工装（CCIP/wd14 venv）、B1 SQLite 15 表、B2 CAS 资产目录。

## P0A · 评测集与能力矩阵

> 当前阻塞：角色形象未固定且 Gate F 未激活。A5–A14 等未完成项须等待总控放行后再执行。

| # | 条目 | 状态 | 验收口径 / 备注 |
|---|---|---|---|
| A1 | 从历史生成筛 30–50 张候选评测图（正/侧/坐/交叉腿、长发遮脸、连衣裙/上下装、透明丝袜、遮挡等场景全覆盖） | ❌ | **角色形象未固定，原 34 张定稿失效；Gate F 激活并固定角色基线后重筛**。旧资产只作留档：动漫 25/写实 9，R18 26/SFW 8；`evalset/final_manifest.json` + `final_sfw/`(8) + `final_r18/`(26, chmod700)；34 张曾入 atelier.db（留档不删） |
| A2 | R18 子集单独隔离目录 + 访问控制 | ✅ | `candidates_r18/`（39 张）chmod 700，与 SFW（12 张）分离；隔离机制保留复用，候选内容随评测集重筛更新 |
| A3 | 评测集标注（可见槽位、遮挡关系、材质标签） | ⛔ | 阻塞于 Gate F 未激活和角色形象未固定；评测集重筛定稿后再开标 |
| A4 | 评测工装接入：`dghs-imgutils`（CCIP/wd14/抠像）+ `sdeval` 网关侧 pip 引入 | ✅ | venv `data/atelier/evaltools-venv`；CCIP 实测 self=0.0000 / 异图 0.4413（`ccip-caformer-24-randaug-pruned` 阈值约 `0.178475`）；mac 侧用 CPU onnxruntime；工装与评测集解耦，保留复用 |
| A5 | 分割方案对比：ClothesSegment vs SegformerB2ClothesUltra vs SAM3 补洞组合 | ⬜ | 按类别 IoU + Boundary F-score 报表 |
| A6 | SegAnimeChara 式「骨架→体积→SAM」皮肤/四肢补路评测 | ⬜ | 与 A5 同一报表口径 |
| A7 | Qwen Edit 硬区域约束实测（supports_region_lock gate） | ⬜ | 结论写回设计文档 §6.1 |
| A8 | FaceID / face-refine 前后身份变化基线（写实 face embedding + 动漫 `ccip-caformer-24-randaug-pruned ≈0.178475`） | ⬜ | 出基线数字，校准 §10.3 阈值；更换 CCIP 变体时必须重新标定，不沿用该阈值 |
| A9 | 各 workflow p50/p95 时延 + 显存峰值实测 → WorkflowCapability 矩阵初版 | ⬜ | 矩阵 JSON 落盘 |
| A10 | 🧪 VTON Spike：家里 5060Ti 16GB 装 CatVTON 社区/相关 ComfyUI 节点冒烟 | ⬜ | 出「能跑/不能跑+速度/显存」结论，只影响 P4 计划 |
| A11 | Qwen Edit Fidelity / Multiangle 联合评测 | ⬜ | 分别记录身份、服装、角度服从、保护区漂移；Multiangle 不冒充 Pose Control |
| A12 | BiRefNet 边缘质量 gate | ⬜ | 发丝、半透明材质、多人隔离；保留人工蒙版精修入口 |
| A13 | Florence2 语义描述质量 gate | ⬜ | 部件描述作为候选，不自动升格 PartDefinition |
| A14 | UltraSharpV2 放大质量 gate | ⬜ | 记录倍率、伪细节、线条和文字破坏 |

## P0B · 域模型与任务协议

| # | 条目 | 状态 | 验收口径 / 备注 |
|---|---|---|---|
| B1 | SQLite schema 定稿（SourceImage/Extraction/RegionObservation/PartDefinition@Revision + Job + Capability） | ✅ | `data/atelier/atelier.db` 15 表 + WAL + 外键 + 软删除；DDL 存 `schema/001_init.sql`；含 slot_rules 版本表与 17 canonical slots CHECK |
| B2 | content-addressed 资产目录（hash 去重） | ✅ | `assets/ab/cd/<sha256>.<ext>` 两级目录；`schema/asset_store.py` 实测重复入库不重复建行 |
| B3 | MaskAsset / EditPlan 蒙版硬保护契约定稿 | ⬜ | 含 crotch_protect 等保护区快照协议 |
| B4 | 漂移检测协议定稿（保护区 LPIPS/SSIM + 容差） | ⬜ | 超阈自动进 awaiting_review |
| B5 | 异步 Job API 骨架（§7.1 全端点 + 202/SSE/cancel） | ⬜ | curl 全端点冒烟通过 |
| B6 | Job 状态机 + 错误码（input_error/oom/comfyui_offline/protection_drift 等） | ⬜ | 单测覆盖状态迁移 |
| B7 | Idempotency-Key + schema_version 全请求支持 | ⬜ | 重复请求不重复建 Job |
| B8 | workflow 注册表 + hash（禁止网关动态散拼节点） | ⬜ | 注册表 JSON + hash 校验 |
| B9 | CapabilityRegistry / WorkflowBinding 对接 | 🟨 | 通用 Registry、主路径 Preflight、WorkflowBinding 与可重放 Shared ExecutionPlan 已接；Atelier 操作级能力路由和运行后回执待补 |
| B10 | Gateway 自动参考图注入：Qwen Fidelity/Multiangle | ⬜ | 消费 `ReferenceBinding[]`，实际引用与降级写入 ExecutionPlan |
| B11 | Gateway 自动参考图注入：BiRefNet/Florence2 | ⬜ | 源图无需手工拼请求，缺引用返回结构化错误 |
| B12 | Runtime Preflight | 🟨 | 普通画布生图/重试已接主路径 gate，可选 ControlNet 故障不再误阻断 txt2img；操作/字段级兼容、真实 smoke、validated pair 和 Atelier UI 接入待补 |

## P1 · 拆解核对台

| # | 条目 | 状态 | 验收口径 / 备注 |
|---|---|---|---|
| C1 | `/decompositions` 主链路：ClothesSegment 主路 + SAM3 补洞 + 多模型融合打标 | ⬜ | 评测集 macro F1 ≥ 0.85（P0A 校准后定稿） |
| C2 | 质量分落库（多维 scores + quality_grade + reasons，不做单值 confidence） | ⬜ | needs_review 正确分流 |
| C3 | 核对台 UI：只显示实际可见槽 → 人工核对/精修 → Observation 落库 | ⬜ | 复用 canvas-node-mask-edit-dialog 精修 |
| C4 | Observation 批准升格 PartDefinition 流程 | ⬜ | 升格带 revision，PATCH 带 expected_revision |
| C5 | 拆解展板导出（消费已确认区域） | ⬜ | 画布可见展板节点 |
| C6 | 拆解验收报表（§10.2 全指标：IoU/Boundary F/错漏槽率/时延/OOM 率） | ⬜ | 报表可复跑 |

## P2A · 安全 R0 编辑（首批槽位：legwear / bottom / dress / hair_front+hair_back）

| # | 条目 | 状态 | 验收口径 / 备注 |
|---|---|---|---|
| D1 | 发色 / 局部材质 / 不改版型 legwear 编辑（梯度蒙版 inpaint） | ⬜ | R0 路由 A 全链路 |
| D2 | 输出漂移 gate（保护区对比 + 自动拦截） | ⬜ | 记录拦截召回率与误杀率 |
| D3 | 一键回滚 | ⬜ | 回滚后资产/DB 状态一致 |
| D4 | Character Profile 自动建档（含 body_constraints 默认锁定） | ⬜ | 身材/胸型不可被普通编辑改动 |
| D5 | 身份一致性验收（§10.3：10–20 角色×3 连续替换，CCIP/embedding 按域拆分 + 人工盲评） | ⬜ | P2 出口门 |
| D6 | 硬保护验收（§10.4：mask 快照→输出对比→容差判定→二次检查） | ⬜ | face-refine 后不得跳过 |

## P2B · R1 单槽结构编辑

| # | 条目 | 状态 | 验收口径 / 备注 |
|---|---|---|---|
| E1 | 整裙/发型轮廓大蒙版修改链路 | ⬜ | R0 达标后才开工 |
| E2 | Qwen Edit gate 结论应用（过 gate 才进生产路由，否则维持实验模式） | ⬜ | 依赖 A7 |
| E3 | R1 + face refine + 二次漂移检查串联 | ⬜ | §6.3 R1 策略 |

## P3 · Outfit 与暖暖感

| # | 条目 | 状态 | 验收口径 / 备注 |
|---|---|---|---|
| F1 | 版本化 Recipe（Exact Replay / Semantic Regenerate） | ⬜ | §10.5 回放验收 |
| F2 | 计划预览（plan/execute 分离 + dry_run） | ⬜ | plan 可见路由/保护区/降级原因 |
| F3 | 串行任务卡片（>R2 拆队列：预览/取消/人工批准） | ⬜ | 对齐 Krita/InvokeAI 交互模式 |
| F4 | accessories 多槽 + CompositionContext 对接场景模板/换姿管线 | ⬜ | 与提示词组合器边界见 §8.1 |
| F5 | 部件库检索/收藏/重打标 | ⬜ | |
| F6 | 风格提案板 | ⬜ | |
| F7 | 完整「角色工坊节点」在画布成型 | ⬜ | P3 出口 |

## P4 · 换姿与跨图取件

| # | 条目 | 状态 | 验收口径 / 备注 |
|---|---|---|---|
| G1 | 换姿产品化（R3：旧观测作废 + 重新分割） | ⬜ | 复用共享 Pose Foundation，不在 Character Atelier 内另造一套骨架执行器；设计与验收细节见 `docs/pose-control-development-plan.md`，启动前置仅以统一总控 Gate D/E 和 Gate F 状态为准 |
| G2 | VTON 产品化（依据 A10 Spike 结论；CatVTON 非商用许可仅内部使用） | ⬜ | 许可证入能力矩阵 |
| G3 | 捏脸模式（反向蒙版：只开放脸区） | ⬜ | |
| G4 | 可选多视图角色表增强 Profile | ⬜ | 非阻塞增强 |

---

## 横切关注（不属于单一阶段，持续生效）

| # | 条目 | 状态 | 备注 |
|---|---|---|---|
| X1 | 敏感资产生命周期（局域网监听/token 鉴权/日志不落原图/TTL/R18 隔离） | ⬜ | §7.4，P0B 起逐步落位 |
| X2 | 显存调度（单 GPU 串行队列/OOM 降级/分辨率上限/健康检查） | ⬜ | §7.3 |
| X3 | 文档同步：每阶段出口更新本清单 + 设计文档相关小节 | 🟨 | 设计文档已到 v0.4，并接入统一总开发计划；后续跨域状态只在总计划维护，本清单只维护 Atelier 验收 |
| X4 | 无限画布普通生图与提示词组合器隔离 | ✅ | 2026-07-14 完整 review：direct/composer 请求分流；普通生图不再执行 smart-compose；full body 不触发 FaceID；无脸自动降级；参考图不上传云端提示词模型；U+0008 正则修复。详见 `Mission_manager/docs/infinite-canvas-prompt-composer-full-review-2026-07-14.md` |
| X5 | 近脸参考→全身角色的身份/画风保真 | 🟨 | 历史 full_body 与五方向 Outpaint 实现/证据保留；Gate A 进行中（U1-R0-P 已冻结）。须完成 U1-R0 18 cells 归因、U1-R 回修和 U1-Z 后，才决定固定角色基线。 |
| X6 | 配置域隔离（Manual / Composer / Outpaint / Inpaint / Atelier / Replay） | 🟨 | 已落地 ManualNodeSettings / SourceGenerationRecipe / OperationProfile / ExecutionPlan，执行计划记录字段来源；空 LoRA `[]` 可持久化，Exact Replay 不再自动补推荐 LoRA；Outpaint/Inpaint 已走托管配置。待高级覆盖 UI 与 Atelier 路由接入 |
| X7 | 共享人体骨骼与姿势控制底座 | ⬜ | 实现与验收统一按 `pose-control-development-plan.md` v0.2；P0 默认单人，Atelier 只在 P4 复用 PoseAsset/Adapter，并在接入时使旧 RegionObservation 作废 |
| X8 | 共享运行时能力池 | 🟨 | 通用 CapabilityRegistry/WorkflowBinding 与画布 Preflight 已接；Qwen Edit、Florence2、BiRefNet、Upscale 的能力专用引用字段、自动注入和运行后回执仍待完成，见 B9–B12 |

## 历史证据入口

旧评测集、Outpaint 迭代与已完成基础设施的逐次记录不再作为执行排期；可复用结果以 A2、A4、B1、B2、X4–X6 的当前状态及其备注为准。跨域状态仅以统一总控为准，`pending-test.mdx` 只保存已实现待验或历史证据。
