# 角色部件工坊 · 外部调研笔记（2026-07-13，已核验）

> 用途：支撑 v0.3 设计文档的外部证据。以下条目均在 2026-07-13 经真实网络检索核验；
> 标注「未核验」的为工程推断或二手转述，引用请以原文为准。

## 1. 动漫角色拆解 / 分层（学术线）

- **See-through: Single-image Layer Decomposition for Anime Characters**（arXiv 2602.03749，2026-02，SIGGRAPH 2026 conditionally accepted，已开源）
  - 单张动漫立绘 → **全补全（fully inpainted）语义分层 + 推导绘制顺序**，目标 2.5D 可动化（Live2D 方向）；输出**分层 PSD**（含 depth map 与分割 mask）。
  - 数据引擎：GradCAM 弱监督 + SAM 分割先验拿粗 2D 分割，再借 **Live2D 渲染引擎**传播成 2.5D 标签 → **19 个语义部位**的像素级监督（含被遮挡区域和 fragment 级绘制顺序）。
  - 关键论点：动漫角色分层是「交错层叠」（如发丝夹脸），通用 RGBA 分层方法假设固定自顶向下顺序，不够用；被遮挡区域必须生成式补全（"artistic hallucination"）。
  - 生态：社区已有 see-through-webui、自动绑骨工具（StretchyStudio / Anime2.5DRig）吃它的 PSD 输出。
  - 作者自评边界：离全自动 Image-to-Live2D 还很远（缺 rigging、缺整体艺术意图），定位是消除手工分割和遮挡补全这两个最繁琐环节。
  - **对本项目**：(a) 印证「部件=观测+补全资产」而非切图；(b) SAM 系只做先验/补洞，主 parser 需要领域化；(c) P4「捏脸/部件重组」如果真要走确定性资产路线，See-through 是现成 Spike 对象（Windows 侧可试装）。
- **Body Part Segmentation of Anime Characters**（Wiley CAVW 2024，pose-based graph-cut）：自然照片训练的 parsing 模型在动漫域直接失效（此条为上一轮调研转述，本轮未重新核验原文）。
- 结论：动漫专用 parsing 没有「拿来即用」的开源强模型；生产上仍以「服装 parsing（ClothesSegment/Segformer）主路 + SAM 系补洞 + 人工核对」为最可靠组合，与 Sol 评审判断一致。

## 2. VTON / VTOFF 现状（2026）

- **CatVTON**（ICLR 2025，arXiv 2407.15886）：
  - 单 UNet 空间拼接（garment|person concat），仅训自注意力；**总参 899.06M / 可训 49.57M**；官方口径 **bf16 下 1024×768 约 <8G VRAM**。
  - **有官方 ComfyUI 部署代码**（custom_nodes + workflow JSON，2024-07 发布）；另有 CatVTON-FLUX（FLUX.1-Fill-dev 的 37.4M LoRA）与 Mask-Free 变体。
  - 自动蒙版依赖 SCHP + DensePose；**许可证 CC BY-NC-SA 4.0（非商用）**——能力矩阵里要记录。
  - 家里 5060Ti 16GB 显存充足（CatVTON 官方口径 <8GB 即可跑），值得 P0 Spike。（2026-07-13 修正：此前误记为 8GB，实为 16GB）
- **IDM-VTON**（ECCV 2024）：SDXL 双 UNet + IP-Adapter，细节保真更好但显存/运维更重；社区实测对输入预处理质量敏感（DensePose 找不到躯干时直接穿错位置）。
- **OmniVTON++**（arXiv 2602.14552，2026-02，训练无关，代码已开源）：Structured Garment Morphing + Principal Pose Guidance + Continuous Boundary Stitching；**明确支持 anime character try-on**，还支持多衣多人在同一 training-free 框架内。对本项目：动漫 VTON 可行性有了学术背书，但工程可用性仍需 Spike 验证。
- **TryOffDiff / VTOFF**（arXiv 2411.18350，BMVC 2025）：定义 Virtual Try-Off 任务——从穿着照重建**标准姿态平铺服装图**（SD + SigLIP 视觉条件）；后续 MGT 扩展多衣。模型许可 SSPL、明确非商用。对本项目：= Reference 态「单品清洗」的学术对应，Reference schema 应预留 canonical garment image 位置。
- **OOTDiffusion**：存在且被广泛对比（arXiv 2403.01779）；上一轮「不支持下装」的说法**不准确**（其 DressCode 训练线覆盖上/下装与连衣裙），不作为排除依据；排除它的真实理由是本机未部署且无动漫域证据。

## 3. 区域控制 / 软蒙版（ComfyUI 生态）

- **Differential Diffusion**（arXiv 2306.00950，已进 ComfyUI 原生）：
  - 三节点组合：`GaussianBlurMask + DifferentialDiffusion + InpaintModelConditioning`；蒙版从二值升级为**逐像素 change map**（灰度=该像素允许的改动强度）。
  - **标准生成底模即可用**，不需要专用 inpaint checkpoint；社区经验 denoise 0.6–0.8 较稳，蒙版过度羽化会波及周边。
  - 对本项目：MaskAsset 契约应支持 `mask_mode: binary | strength_gradient`；R0 材质级替换用梯度蒙版可显著减少接缝。
- **denoise 蒙版 ≠ blend 蒙版**：Krita AI Diffusion 从一个选区派生**两张不同用途的蒙版**——`Selection Feather`（去噪蒙版过渡带，按选区尺寸百分比，且随 strength 缩放）与 `Selection Blend`（合成 alpha 过渡带，绝对像素）；两者都设 0 则完全关闭自动蒙版处理。EditPlan 里 denoise_mask 与 blend_mask 应是两个字段。
- **Regional prompting（Attention Couple / 区域 conditioning 系）**：mask 绑定 conditioning 的「软约束」路线，给控制但不给绝对控制（本条为社区共识总结，未附单一出处）。印证系统不变式：区域 prompt 只当辅助，硬保护必须靠蒙版挖除 + 生成后校验。

## 4. 产品交互参考

- **Krita AI Diffusion**（Acly，GitHub 8.7k★）：
  - **Regions**：图层绑定区域 prompt（layer=区域=独立描述），与本项目「槽位=区域=semantic」同构。
  - **Job Queue + Cancel + History**：排队、取消、历史结果随时回看——任务卡片的成熟先例。
  - 蒙版参数产品化：Feather/Blend 两级 + `Selection Padding` 控制上下文范围；Custom Generation 提供 **Selection Bounds**（只用选区）等 context 选项；可保存命名选区蒙版复用为 context。
  - 上下文成本明示：「整个 context 都要付费（算力），不只是蒙版区」——EditPlan 的 context 策略要显式化。
  - 分割能力拆成独立插件（Krita AI Tools），不和生成插件耦合。
- **InvokeAI Canvas**：分阶段生成 + staging area 接受/拒绝中间结果（上一轮调研转述，本轮未重新核验）。
- **Live2D / 纸娃娃系**：确定性分层资产（素材+锚点+z-order+互斥）；See-through 正是拿商业 Live2D 资产反向 bootstrap 训练数据。印证 Sol：游戏式换装本质是结构化资产系统，diffusion 只能模拟其效果；近期定位应为「受控局部编辑 + 部件灵感库」。

## 5. 对 v0.3 的直接影响清单

1. MaskAsset 增加 `mask_mode`（binary/strength_gradient）；EditPlan 区分 `denoise_mask` 与 `blend_mask`、增加 `context_mode`（selection_bounds/entire_image/custom_region）。【来源：DiffDiff + Krita】
2. SAM3 定位锁死为「补洞/先验」，主 parser 为服装 parsing 系；动漫域没有免费午餐。【来源：See-through + CAVW】
3. VTON Spike 提前到 P0（CatVTON <8G 可跑 + 官方 Comfy 节点 + OmniVTON++ 动漫背书）；能力矩阵记录**许可证**（CatVTON 非商用、TryOffDiff SSPL）。
4. Reference 态 schema 预留 VTOFF「canonical garment image」位置。
5. Regional prompting 明确为软辅助层，不进硬保护链路。
6. 任务卡片对齐 Krita/Invoke 的 queue+cancel+history+staging（人工批准）模式。
7. 远期「确定性部件重组」如立项，先 Spike See-through（分层 PSD 输出可直接喂展板/部件库）。

---

## 6. 二轮调研（v0.3 自审轮，2026-07-13 已核验）

### 6.1 动漫身份指标：CCIP（deepghs）
- CCIP = Contrastive Anime Character Image Pre-Training，专测「两张图是不是同一个动漫角色」；差异值越小越同一（同角色示例 0.166，异角色 0.39–0.44）。
- 限制：**单角色图**；主模型由 7eu7d7 训练，各模型阈值/指标数据托管在 `deepghs/ccip_onnx`；默认模型 `ccip-caformer-24-randaug-pruned` 阈值 **0.178475**（F1 曲线最大点定阈，F1≈0.94）。
- 工程接入：`pip install dghs-imgutils` → `imgutils.metrics.ccip_difference / ccip_same / ccip_clustering`；纯网关侧可跑，不需要 Comfy 节点。
- 同库还有 `get_wd14_tags`（带 rating/characters 输出，可替代 DeepDanbooru 做区域打标融合）与 `segment-rgba-with-isnetis`（单角色抠像）。
- deepghs 生态另有 **sdeval**（SD 出图量化评估框架）、anime YOLO 人物/头/脸检测——评测集工装可整套复用。
- 实战先例：neme-anima（LoRA 数据管线）用「YOLO 检测 → ByteTrack → CCIP 归角色 → wd14 打标」，与本项目评测链路同构。
- **对 v0.3**：§10.3 身份验收按域拆分——写实用 face embedding，动漫用 CCIP（不能拿真人脸模型测动漫脸）。

### 6.2 动漫部位分割生态再确认（部位级仍是缺口）
- SkyTNT/anime-segmentation：**整角色**前景分割（ISNet/U2Net/MODNet/InSPyReNet），用于抠像/去背景。
- CartoonSegmentation（dreMaz/AnimeInstanceSegmentation，"Instance-guided Cartoon Editing" 论文实现）：**角色实例**分割（RTMDet 检测 + ISNet 精修）。
- ComfyUI 节点包 `comfyui_animeseg`（craig-tanaka）：SimpleAnimeSeg（SkyTNT ONNX）+ AdvancedAnimeSeg（CartoonSegmentation ONNX），CPU 向。
- 结论：开源动漫分割全部是**角色级**，无部位级 parsing —— 再次证实「服装 parsing + SAM 补洞 + 人工核对」组合；角色级模型可当**前置抠像**（多角色图先隔离单角色，也是 CCIP 的输入前提）。

### 6.3 SegAnimeChara（SIGGRAPH 2023 Posters）：骨架→体积部位→SAM
- 流程：OpenPose 骨架 → **BodyPix 体积化身体分区**（零样本切动漫身体部位）→ 部位 mask 转 bbox → SAM 细化；语义物件（如「gun」）走 RegionClip 找 bbox → SAM。
- 局限（作者自述）：发型/尾巴/蝴蝶结等特殊特征 BodyPix 不覆盖；被遮挡部位形状预测仍是 future work。
- **对 v0.3**：§4.3 crotch_protect「骨架推导保护区」有直接学术先例（骨盆关键点长体积区域）；皮肤/四肢类身体区域分割候选补路，P0A 评测一并对比。
- 关联核验：CAVW 2024《Body Part Segmentation of Anime Characters》原文确认——自然照片训练的 parsing 模型因视觉域差在动漫图上直接失效（pose-based graph-cut 是其替代方案）；上一轮「转述未核验」升级为已核验。
- See-through 原文（arXiv HTML）补充确认：与 SAM3 按 19 部位对比，SAM3 在动漫角色上常产出**不完整/重叠**的 mask（漏发/漏裤、像素分配不全局一致）——§5 SAM3 只做补洞的定位再添一证。

### 6.4 对 v0.3 的增量影响（已写入设计文档）
1. §4.1 梯度蒙版链路节点已在本机 Comfy `object_info` 核验在位（DifferentialDiffusion / InpaintModelConditioning / FeatherMask / GrowMask / GrowMaskWithBlur / ImpactGaussianBlurMask / MaskBlur+ / ImageCompositeMasked）——零安装。
2. §5 打标融合：网关侧可用 imgutils `get_wd14_tags` 替代 DeepDanbooru（带 rating，质量更好）。
3. §10.1 评测工装：deepghs `sdeval` + `dghs-imgutils` 整套复用，避免自造脚手架。
4. §10.3 身份指标按域拆分：动漫 CCIP（阈值参照 ccip_onnx 各模型数据）/ 写实 face embedding。
5. §4.3 / §5：SegAnimeChara 骨架→体积→SAM 作为 crotch 推导与身体区域候选补路。
