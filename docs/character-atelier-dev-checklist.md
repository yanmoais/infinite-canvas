# 角色部件工坊 · 开发清单（Dev Checklist）

> 配套设计文档：`character-atelier-design.md` v0.3（§16 已于 2026-07-13 全部拍板）。
> 本文件是**唯一执行进度看板**：每个条目只在实际验证通过后才改状态，禁止「写完代码就打勾」。
>
> 创建：2026-07-13 · 维护：囡囡 · 审阅：BOSS

## 状态图例

| 标记 | 含义 |
|---|---|
| ⬜ 未开始 | 还没动工 |
| 🟨 进行中 | 有代码/产物但未过验收 |
| ✅ 已完成 | 有可复现证据（命令/截图/评测数字）且过验收口径 |
| ⛔ 阻塞 | 依赖未就绪或有外部阻断，备注写明原因 |
| 🧪 实验 | Spike/验证性质，结论落盘即算完成 |
| ❌ 已作废 | 产物或结论失效，不再作为验收依据 |

## 已拍板前提（2026-07-13）

- 节奏：P0A+P0B 并行，合计一周内，P1 紧跟。（2026-07-14 调整：P0A 暂停，主线转 Outpaint 双模式，见「当前主线」）
- 存储：网关侧 `Mission_manager/data/atelier/`（SQLite WAL + content-addressed assets）。
- P2A 首批槽位：legwear / bottom / dress / hair_front+hair_back。
- 身材/胸型：`Profile.body_constraints`，默认锁定，不做可换槽。
- VTON Spike：家里 5060Ti **16GB** 直接跑（CatVTON 官方口径 <8GB 可跑）。
- 评测集：囡囡从历史生成筛 30–50 张初版 → BOSS 过目定稿。（2026-07-14 作废：角色形象未固定，稳定出图后重筛）

---

## 当前主线（2026-07-14 转向）

- **P0A 评测集定稿作废**：角色形象尚未固定，2026-07-13 定稿的 34 张评测集失效（A1 改 ❌、A3 转 ⛔）；atelier.db 中 34 行 source_images 与已入库资产先留档不删，重筛时再决定清理或复用（删除需 BOSS 确认）。
- **主线 = Outpaint 双模式（全身重构 / 原图续接）稳定出图**：先做到用近景参考稳定产出合格全身图（X5 验收：头入镜、腿脚完整、裙摆/衣物合理、脸部身份与画风保真），角色形象固定后再重启 P0A 重筛评测集，继续 P0B → P1。
- **保留复用（不作废）**：A2 R18 隔离机制、A4 评测工装（CCIP/wd14 venv）、B1 SQLite 15 表、B2 CAS 资产目录。

## P0A · 评测集与能力矩阵（3–5 天）

> ⚠️ 2026-07-14 暂停：评测集定稿作废（角色形象未固定）。A5–A10 待角色形象固定、评测集重筛后再排期。

| # | 条目 | 状态 | 验收口径 / 备注 |
|---|---|---|---|
| A1 | 从历史生成筛 30–50 张候选评测图（正/侧/坐/交叉腿、长发遮脸、连衣裙/上下装、透明丝袜、遮挡等场景全覆盖） | ❌ | **2026-07-14 作废：角色形象未固定，34 张定稿失效；待 Outpaint 双模式稳定出图、角色形象固定后重筛**。原定稿留档：BOSS 2026-07-13 勾选 34 张（动漫 25/写实 9；R18 26/SFW 8）；`evalset/final_manifest.json` + `final_sfw/`(8) + `final_r18/`(26, chmod700)；34 张曾入 atelier.db（留档不删） |
| A2 | R18 子集单独隔离目录 + 访问控制 | ✅ | `candidates_r18/`（39 张）chmod 700，与 SFW（12 张）分离；2026-07-14：隔离机制保留复用，候选内容随评测集重筛更新 |
| A3 | 评测集标注（可见槽位、遮挡关系、材质标签） | ⛔ | 2026-07-14：阻塞于角色形象未固定；评测集重筛定稿后再开标 |
| A4 | 评测工装接入：`dghs-imgutils`（CCIP/wd14/抠像）+ `sdeval` 网关侧 pip 引入 | ✅ | venv `data/atelier/evaltools-venv`；CCIP 实测 self=0.0000 / 异图 0.4413（阈值 0.178）；mac 侧用 CPU onnxruntime；2026-07-14：工装与评测集解耦，保留复用 |
| A5 | 分割方案对比：ClothesSegment vs SegformerB2ClothesUltra vs SAM3 补洞组合 | ⬜ | 按类别 IoU + Boundary F-score 报表 |
| A6 | SegAnimeChara 式「骨架→体积→SAM」皮肤/四肢补路评测 | ⬜ | 与 A5 同一报表口径 |
| A7 | Qwen Edit 硬区域约束实测（supports_region_lock gate） | ⬜ | 结论写回设计文档 §6.1 |
| A8 | FaceID / face-refine 前后身份变化基线（写实 face embedding + 动漫 CCIP ≈0.178） | ⬜ | 出基线数字，校准 §10.3 阈值 |
| A9 | 各 workflow p50/p95 时延 + 显存峰值实测 → WorkflowCapability 矩阵初版 | ⬜ | 矩阵 JSON 落盘 |
| A10 | 🧪 VTON Spike：家里 5060Ti 16GB 装 CatVTON 官方 Comfy 节点冒烟 | ⬜ | 出「能跑/不能跑+速度/显存」结论，只影响 P4 计划 |

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
| G1 | 换姿产品化（R3：旧观测作废 + 重新分割） | ⬜ | |
| G2 | VTON 产品化（依据 A10 Spike 结论；CatVTON 非商用许可仅内部使用） | ⬜ | 许可证入能力矩阵 |
| G3 | 捏脸模式（反向蒙版：只开放脸区） | ⬜ | |
| G4 | 可选多视图角色表增强 Profile | ⬜ | 非阻塞增强 |

---

## 横切关注（不属于单一阶段，持续生效）

| # | 条目 | 状态 | 备注 |
|---|---|---|---|
| X1 | 敏感资产生命周期（局域网监听/token 鉴权/日志不落原图/TTL/R18 隔离） | ⬜ | §7.4，P0B 起逐步落位 |
| X2 | 显存调度（单 GPU 串行队列/OOM 降级/分辨率上限/健康检查） | ⬜ | §7.3 |
| X3 | 文档同步：每阶段出口更新本清单 + 设计文档相关小节 | 🟨 | 清单已建；2026-07-14 已补 X5 双模式状态。设计文档已到 v0.3.3；§8.2C Outpaint 双模式 + full_body 1.5~1.75 画幅已同步代码 |
| X4 | 无限画布普通生图与提示词组合器隔离 | ✅ | 2026-07-14 完整 review：direct/composer 请求分流；普通生图不再执行 smart-compose；full body 不触发 FaceID；无脸自动降级；参考图不上传云端提示词模型；U+0008 正则修复。详见 `Mission_manager/docs/infinite-canvas-prompt-composer-full-review-2026-07-14.md` |
| X5 | 近脸参考→全身角色的身份/画风保真 | 🟨 | **2026-07-14 五次修复**：主图改 soft IPAdapter（EmptyLatent + prompt 优先）锁身份气质，纠正 pure txt2img 漂角色；构图正负向 + 上半区无脸重试 + 脸部后精修保留。原图续接上/下/左/右。**待 BOSS 近景再验**（脸/发/装是否同人 + 头脚是否入镜）。 |
| X6 | 配置域隔离（Manual / Composer / Outpaint / Inpaint / Atelier / Replay） | 🟨 | 已落地 ManualNodeSettings / SourceGenerationRecipe / OperationProfile / ExecutionPlan，执行计划记录字段来源；空 LoRA `[]` 可持久化，Exact Replay 不再自动补推荐 LoRA；Outpaint/Inpaint 已走托管配置。待高级覆盖 UI 与 Atelier 路由接入 |

## 变更日志

| 日期 | 变更 |
|---|---|
| 2026-07-13 | 建档；§16 六项拍板落定；修正 5060Ti 显存 8GB→16GB 历史误差 |
| 2026-07-13 | P0 开工：A1 候选 51 张归集待过目、A2 ✅、A4 ✅（CCIP 跑通）、B1 ✅（15 表建库）、B2 ✅（CAS 去重验证）；评测集工作目录 `Mission_manager/data/atelier/evalset/`，BOSS 核对入口 `review_sfw.html` / `review_r18.html` |
| 2026-07-13 | A1 ✅ 定稿：BOSS 勾选 34/51（SFW 8、R18 26），归集 `final_sfw/`+`final_r18/` 并全部入库（assets CAS 去重 + source_images 34 行）|
| 2026-07-14 | X4 ✅：完成无限画布提示词组合器跨功能污染审查与修复；普通输入框、局部编辑、重试和组合器路径已分界；本地 ComfyUI 冒烟 HTTP 200 |
| 2026-07-14 | X5 🟨：完成图二近脸参考→1152×2048 全身图的工作流级取证，确认不是续图而是全图重抽；明确 7 项根因与 P0/P1 改造路线 |
| 2026-07-14 | X6 🟨：定稿本地工作流设置、提示词组合器、Outpaint、局部编辑、角色工坊与 Exact Replay 的配置隔离契约 |
| 2026-07-14 | X5/X6 P0：实现托管向下 Outpaint、源图配方继承、字段来源执行计划、明确空 LoRA 与蒙版 Exact Replay；FaceDetailer UI 与网关默认语义对齐 |
| 2026-07-14 | X5 review（grok-4.5）：确认双模式 UI/几何/执行计划/网关蒙版语义与像素回贴链路；单测通过；**未验收实图**。发现 denoise 滑条 max=0.9 与全身默认 0.92 冲突并已修；设计文档 denoise=0.62 口径过时 |
| 2026-07-14 | X5 畸变修复：full_body 改 FaceID 全身重生成；废除缩小锚点硬贴；长幅 2:1 上限；单测/tsc 通过 |
| 2026-07-14 | X5 二次修复：full_body 裁头/只出下半身——画幅 1.5~1.75、构图正负向、网关 full_body_rebuild、重试无蒙版放行、identity 重试保留；单测/tsc/网关已重启 |
| 2026-07-14 | X5 三次修复：图一弯腰折叠畸变——跳过换姿优化器(禁 standing)；FaceID 失败改 soft PLUS FACE 非 character；站立正负向+脸部裁切；网关已重启 |
| 2026-07-14 | X5 四次修复：主图 pure txt2img 构图优先 + 上半区无脸自动重试；原图续接支持上/下/左/右；单测/tsc 通过 |
| 2026-07-14 | X5 五次修复：主图 soft IPAdapter 锁身份（纠正 pure txt2img 漂角色）+ EmptyLatent 保构图；单测/tsc/网关重启 |
| 2026-07-14 | X5 续：一键外扩（四边）；全身重构松姿势锁（face crop soft IPA + 正视/不低头负向） |
| 2026-07-14 | **计划转向**：角色形象未固定，P0A 评测集定稿作废（A1 ❌、A3 ⛔；A2/A4 机制与工装保留）；主线切到 Outpaint 双模式稳定出图（X5），稳定出图后重启 P0A → P0B → P1 |
