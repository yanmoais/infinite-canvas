# CHANGELOG

## Unreleased

- [新增] 无限画布接入「几乎原图复刻」独立参考模式 `identity_clone`：Mission_manager 模板 `sdxl-identity-clone-api.json`（FaceID PLUS V2 + IPAdapter 风格构图 + Canny/Tile + denoise 0.22），`illustrious-mmmix-v8` 支持该模式，画布 Comfy 设置下拉可直接选择。
- [调整] Gate 0 / C0-Z 独立验收通过：约定测试 7/7、diff check 与五轮独立 review 终轮 PASS；加固 U1-R0 FROZEN schema/语义门（固定矩阵身份、顶层对齐、A/B 仅 LoRA 差异、目标尺寸冻结）；Gate 0 = DONE，真实 U1-R0 manifest 与 18 cells 仍未开跑。
- [调整] Gate 0 / C0-6 测试与文档：U1-R0 执行合同与 schema 落盘至主线（manifest 模板 / request hash / attempts / pairs / taxonomy）；新增离线合同测试；真实实验 manifest 与 18 cells 仍未开跑。
- [调整] Gate 0 / C0-5 UI 调用链合流：Outpaint 支持续接模型选择、source lock 与跨模型显式空 LoRA；提交前走 `preflightComfyOutpaint`，主线提示词编译后写入 Shared ExecutionPlan。
- [调整] Gate 0 / C0-4 Shared Core 合流：`OperationProfile.modelOverride` 跨模型续接显式清空 LoRA；source node provenance、`ipadapter_template` 选择、`preflightComfyOutpaint` 与资产 ID 规范化已合入；资产诊断后缀识别 Gateway 中文 `(ComfyUI 未扫到)` / `(Loader 无枚举)`，不可执行 binding 不再写入 ExecutionPlan；仅 lib/service，未接 UI。
- [调整] 同步官方 v0.9.0，接入画布插件系统、可调侧栏与资产管理、提示词图片引用、透明背景和运行时统计配置，同时保留本地 Comfy、画面扩图、生成契约与 Agent 工具桥二开。
- [修复] Outpaint 已停用 LoRA profile 不再出现在前端推荐列表，也不能通过显式 profile ID 继续执行；历史 A/B 备注收敛为请求级观察，不再把缺少 `actualLoras` 完整性的旧回执写成 LoRA 因果结论。
- [新增] 生成回执 v2 已加载共享 Gateway：最终 ComfyUI 执行图的逐阶段实际 LoRA、完整性与 opaque loader 记录支持跨阶段聚合；planned/actual preset 分离与 `fallback.preset` 可表达请求侧回退；bare、动态 LoRA、pre-submit `unknown` 与 invalid-preset 回退的可复算在线证据见 `.uat/gate-0/c0-3-receipt-v2/`，FaceID/多阶段 live 验证留 Gate B。
- [调整] 文档/开发计划：将统一总控压缩为 Gate 0→G 单一队列，新增主线/PoC/Gateway 逐文件合流与运行环境隔离规则，并把 U1-R0 manifest、实际 LoRA 完整性证明和 18 cells 裸模 A/B 设为 Gate A 内 U1-R0 开跑前置。

- [调整] Gate A / U1 从“等 BOSS 瞟一眼终验”改为 U1-QA 结构化视觉验收 + U1-R 定向回修 + U1-Z 终验；经 Claude Fable / GPT Sol 对抗审查回写 seamContinuity 硬门、qa-report 契约、止损与出口定义

- [新增] U1-QA v1 工具链：geometry 驱动 PNG crops、seamContinuity/空间暗区/相对色偏指标、显式阈值与 qa-report；已对 U1-A 五方向重算并暴露 left 硬缝

- [调整] U1-R up 专项结论：整幅自由 inpaint 不可用；默认路径改为 hybrid（远端软垫图 + 发际窄带 inpaint）；Illustrious OpenPose CN 延期至 Pose/full_body，U1 不下装

- [调整] up-hybrid 三 seed 目视全否后升级诊断：根因含工作流（txt2img+SetLatentNoiseMask 非专业 outpaint）；C 站对照 Inpaint AIO/Fooocus/BrushNet，下一步做实验 mutator

- [新增] U1-A 五方向默认矩阵真实提交：同一基线/seed/推荐 LoRA 跑通 up/down/left/right/outward，落回执与指标；down 指标最佳，up 指标失败，left/right/outward 待视觉

- [修复] 向下原图续接绿衣突变：尊重 UI denoise、中段衣物稳健垫图、绿衣负向 densify，并新增暗空洞负向；默认 denoise 下调到 0.60，U1 A2R9 指标 gdom 0.33 / dark% 24.6


- [优化] 托管 Outpaint 支持 Registry 操作级 LoRA/denoise profile 并写入运行回执；U1 同 Seed A/B 的失败候选已停用，历史结果只保留为铺底 latent 与 LoRA 影响的诊断线索，不作为因果结论

- [新增] 完成 Runtime Capability U2-C：WorkflowBinding 字段兼容、生产默认 WAI 真实 smoke、物理模型哈希与 validated pair、Gateway 生图/编辑阶段化运行后回执、画布节点回执保存及 Web 质量 CI

- [修复] 修复蒙版 inpaint 和多阶段局部精修只保留最后一跳回执、错误标记 fallback、空 media 无回执的问题，并补 ControlNet 架构/普通路径 pair gate 与前端回执契约校验

- [调整] Runtime Capability U2-C 经 `grok-4.5` 复审确认无 Blocking/P0，M2 关闭；FaceID/IPAdapter 资产级绑定、逐 part 精修回执和真实编辑 smoke 转入后续深化

- [新增] U2-E 为 WAI/SDXL FaceID/IPAdapter 专用工作流登记完整参考资产哈希和显式哈希状态，逐次记录默认 face→skirt、可选 hair 的精修回执，并拒绝架构字段为空或空白的 validated pair

- [修复] 根据 `grok-4.5` U2-E 审查补齐 buffalo_l 五文件库存、可选参考能力缺失诊断、真实 Registry/架构组合/stage 组装回归，并对齐参考模板默认参数与局部精修 mutator

- [修复] 修正 Windows CLIP Vision 物理资产的 Comfy-Org 溯源，披露 InsightFace 非商用许可边界，补齐回执 `hashStatus` 类型与 stage 深校验，并修复 Mission_manager 全仓两个存量红测

- [调整] 历史总计划曾采用 Gate A→G 队列；该入口已被当前 Gate 0 收敛门取代，U1 Outpaint、U2-E Windows 编辑 smoke、U2-D 自动引用、U3/U4 Pose、Character Atelier 与 Story 均须按 Gate 0→G 顺序推进。

- [修复] 根据 U2-E 独立复审将资产哈希状态从误导性的 `verified` 改为 `registered`，把 InsightFace 许可元数据透传到 Capability/回执，并补齐回执边界负例和旧回执降级说明

- [调整] U2-E 修复复审当时无 Blocking/P0；“允许进入 U1”的旧放行结论已被当前 Gate 0 收敛门取代。Windows 真实编辑 smoke 保留为 Gate B 独立视觉验收门。

- [新增] 接入 `/api/v1/capabilities`、WorkflowBinding 与 RuntimeAssetRequirement；普通画布生图和图片重试现已执行 ComfyUI Preflight，不可用时阻断、降级时展示原因

- [新增] Mission_manager Gateway 聚合 Registry、工作流哈希、ComfyUI 节点和 Loader 枚举，返回可追踪的运行时能力状态

- [新增] Comfy 画布生图将实际参考节点、模型、能力决策、可证明的 WorkflowBinding/工作流哈希、运行时资产哈希和降级原因写入 Shared ExecutionPlan

- [新增] 启动 Shared Generation Core M0：统一共享生成类型、操作/媒体类型边界、Pose 与能力注册最小契约，并新增复用现有 smart compose 的类型化 PromptCompiler

- [新增] Shared Generation Core 支持按 revision/contentHash 将真实引用变化上游的直接下游 ExecutionPlan 标记为 stale

- [新增] Mission_manager Gateway 增加 pose_control 最小契约校验，并对未接真实 WorkflowBinding 的合法请求明确返回未就绪错误

- [修复] Runtime Capability 改用主工作流判断可提交状态，可选 ControlNet 故障不再误阻断健康纯文生图或注入无关警告

- [修复] Comfy 图片重试保留原 Shared ExecutionPlan 的绑定与哈希事实，只叠加当前能力预检结果；图片替换同步递增 revision/contentHash

- [调整] 统一设计开发计划补齐 U2-C 验证批次、U2-D 自动引用批次、验收门责任与可执行测试入口，并分区整理当前版本和历史遗留待验事项

- [修复] 修复 Shared Generation Core stale 传播的 TypeScript 字面量拓宽和测试入口依赖缺失，补充 store `updateProject` 级回归并完成前端 7/7 测试与 typecheck 验证

- [优化] 原图续接（尤其向上）接缝改软蒙版：前端 seam 渐变 + 分层垫图，网关保留 alpha 梯度、拆 denoise/blend mask、向上关闭 GrowMask

- [修复] 向上补全不再因提示词优化器改写而生成第二人/光环角色

- [修复] 一键外扩/原图续接头顶多余摄像机与肩部畸形：根因是网关反提示词（final_negative）整段丢弃、从未真正写入生成节点；现已合并注入，并为所有续接方向统一补齐相机/底座/多余肢体/接缝痕迹排除词

- [修复] 原图续接 / 全身重构自定义提示词不再被优化器静默丢弃：未修改面板默认词时严格只用规范默认词；用户确实改过默认词时改为轻量直译原意，不再整体改写替换

- [调整] 生图提示词优化器按有无参考图拆分规则，无参考图的纯提示词生图（含组合器生产内容）只做措辞规范化和中译英，不再套用参考图专用的姿势改写规则

- [修复] 原图续接（非全身重构）重试丢失方向与接缝融合宽度参数的问题
- [调整] 原图续接面板文案与选项标签对齐全身重构：方向改为“向上/下补全、左右扩展”，画幅改为“小幅/标准/大幅续接”。
- [修复] 全身重构改为主图 pure txt2img 构图优先，上半区无脸自动强构图重试，脸部后精修锁身份，缓解只出下半身。
- [新增] 原图续接支持上/下/左/右四个方向，可向上补头或向两侧扩展画面。
- [调整] 扩图入口文案由“向下扩图”改为“画面扩图”，面板按模式展示方向选择。
- [优化] 图片节点工具条改为紧凑单行图标栏，次要操作收进“更多”，默认不显示长文字，避免盖住小节点。
- [新增] 图片节点新增托管画面扩图，支持“全身重构 / 原图续接”双模式、单语英文提示词、接缝蒙版、源图配方继承、像素保护和执行计划查看。
- [修复] 全身重构改为原图 FaceID 锁脸 + 全身重生成，废除缩小硬贴高 denoise 路径，限制过长竖图，缓解解剖畸变。
- [修复] 本地 Comfy 配方保留明确空 LoRA，重试不再自动补推荐 LoRA；FaceDetailer 未设置时界面与网关默认开启语义一致。
- [修复] Codex MCP 写画布：默认关闭工具确认、headless 工具桥跳过确认、确认 25s 超时，避免写操作 30s 卡死。
- [修复] 区分「Agent 在线」与「画布已连接」；进入画布且 Agent 启用时自动挂 headless 工具桥。
- [修复] MCP 启动时自动探测并尝试拉起本机 HTTP Agent；Origin 改为首绑锁定。
- [修复] `/config` 在本机 CLI 或已绑定 Origin 时返回 token；文档与 open-canvas skill 对齐 Vite 启动方式。

## v0.9.0 - 2026-07-17

+ [调整] 画布节点名称默认不再显示,仅在选中/悬停/编辑时出现,画布更简洁。
+ [新增] 左侧面板「资产」Tab 支持上传添加图片/视频资产、卡片悬停移除资产。
+ [新增] 左侧画布面板支持拖拽调整宽度、展开/收起(带动画),顶栏菜单左侧新增面板开关按钮。
+ [新增] 顶栏菜单新增「导出当前画布」,导出为包含全部资源的压缩包。
+ [新增] 左侧画布元素列表支持多选并批量导出选中元素为压缩包。
+ [优化] 左侧面板「画布/资产」切换改为带滑动下划线的动画,移除非图片元素图标的灰色底色。
+ [新增] 可选的网站统计分析:支持 Google Analytics 4 与百度统计。
+ [优化] 画布节点提示词面板 `@` 引用图片时,输入框内直接显示真实缩略图。
+ [优化] 移除画布节点右上角的「图片1/文本1」资源角标,引用改在对话面板 `@` 直接选取。
+ [修复] 连接本地 Codex Agent 后,拖拽画布节点边框缩放等高频编辑导致页面崩溃。

## v0.8.2 - 2026-07-16

+ [新增] 图像设置新增「透明背景」开关,开启后生成无背景的透明图像。
+ [修复] 画布节点提示词输入框补上悬停文本光标。
+ [优化] 画布节点输入区域移除灰色底色与边框、美化样式。

## v0.8.1 - 2026-07-16

+ [新增] 插件 SDK 扩展:AI 生成能力、面板控制能力。
+ [优化] 3D 全景(1.1.0)支持上传与 AI 生成并升级查看器;
+ [优化] HTML 节点(1.2.0)迁移到统一交互开关;
+ [优化] 便利贴(1.1.0)可拖动移动、自选颜色、移除资源角标与衍生功能;
+ [优化] SVG 节点(1.1.0)透明背景融入画布、可拖动、去除默认值;
+ [优化] 画布节点渲染性能:memo 化节点回调,交互时不再全量重渲染;
+ [修复] 修复 Markdown 节点在点击/移动视角时重复渲染导致图片反复请求的问题;
+ [修复] 修复插件版本号显示不更新，插件面板新增可升级绿点提醒。

## v0.8.0 - 2026-07-15

+ [新增] 画布节点插件系统:支持通过 URL 动态安装/启用/更新/卸载远程节点插件。
+ [新增] 插件开发 SDK,可用 TypeScript 开发画布节点插件。
+ [新增] 新增 Markdown、SVG、HTML、3D 全景、便利贴等示例插件。
+ [新增] 官方插件注册表:节点插件面板可从项目仓库读取官方插件列表并一键安装。
+ [新增] 在画布右上角工具栏新增「节点插件」入口。
+ [新增] 支持自定义生图/视频接口调用方式以适配不同中转站。

## v0.7.1 - 2026-07-15

+ [修复] 修复页面白屏报错的问题。

## v0.7.0 - 2026-07-14

+ [新增] Agent 对话消息改用 streamdown 流式渲染，提升Markdown 内容展示效果。
+ [新增] Agent 新增画布、工作台、提示词库和素材等站点级工具。
+ [新增] Agent 面板改为全站常驻右侧栏，开关时同步推动顶栏和页面内容。
+ [新增] Agent 新增 `site_navigate` 工具，支持页面跳转。
+ [新增] Agent 对话运行中支持一键停止，中断当前 Codex turn。
+ [新增] 画布节点支持统一维护名称字段，默认显示在节点上方，并可直接双击名称编辑。
+ [新增] 画布新增组节点，支持节点拖入/拆出分组、拖拽高亮吸附和移动组时带动子节点。
+ [新增] 画布空白区域支持双击打开节点选择菜单，并在点击位置创建节点。
+ [调整] Codex 会话改为站点级连续线程，跨页面和跨画布保持同一上下文。
+ [调整] 移除仅前端调用 OpenAI responses 接口，统一走 MCP + 本地 Codex 链路。
+ [调整] 画布节点顶部工具条改为点击选中节点后显示，避免鼠标经过节点时频繁弹出。
+ [优化] 本地 Agent 连接说明明确区分插件 / 手动 MCP 才会增加 Codex token 消耗。
+ [优化] 优化本地 Agent 连接说明，区分 Codex 插件启动和直接运行 Agent 两种方式。
+ [修复] 修复 Gemini 格式生图时因内置比例列表触发误报导致生成失败的问题。

## v0.6.0 - 2026-07-09

+ [新增] 新增Codex App插件支持。
+ [新增] 配置与用户偏好新增独立页面和 Codex 连接配置 Tab。
+ [新增] 新增GitHub Pages 前端静态站点发布 workflow。
+ [新增] 图片切图支持等分线直接拖拽调整，并可新增、删除和重置横向 / 纵向切图线。
+ [调整] Docker 运行镜像改为 nginx 静态托管。
+ [调整] 移除网站Agent模式，专注于连接Codex Agent操作画布
+ [修复] 修复生图工作台重试成功结果刷新后丢失的问题。
+ [修复] 修复 Gemini 调用格式生图未传递尺寸比例配置的问题。
+ [修复] 修复前端 TypeScript 构建报错。
+ [修复] 修复画布生成配置切换文本/视频/音频模式时模型仍显示为生图模型的问题。
+ [修复] 兼容中转站视频任务直接返回视频 URL 且没有 `/content` 接口的情况，并优化失败原因展示。

## v0.5.0 - 2026-07-05

+ [新增] 渠道兼容Gemini格式。
+ [调整] 前端从 Next.js 迁移到 Vite，项目改为静态前端构建。
+ [调整] 移除已 404 的 EvoLinkAI 提示词来源。

## v0.4.0 - 2026-06-16

+ [新增] 新增网页版Agent Loop模式。
+ [新增] 支持Vercel一键部署。
+ [调整] 移除后端，项目定位为个人画布工具。

## v0.3.0 - 2026-06-15

+ [新增] 新增canvas-agent通过codex操作画布。

## v0.2.5 - 2026-06-08

+ [新增] 新增图片切图功能。
+ [新增] 支持webdav同步数据。
+ [修复] 修复画布文字节点错误问题。

## v0.2.4 - 2026-06-04

+ [新增] 新增图片反推提示词功能。

## v0.2.3 - 2026-06-04

+ [新增] 新增图片蒙版局部修改功能。
+ [优化] 优化配置节点@图片功能。

## v0.2.2 - 2026-06-04

+ [新增] 新增图片放大工具。
+ [优化] 优化图片工具条，增加自定义功能。
+ [修复] 修复端口冲突问题、pg/mysql未初始化问题。

## v0.2.1 - 2026-06-03

+ [新增] 新增文档站点页面。
+ [优化] 优化画布连线交互。
+ [优化] 优化模型选择用户偏好。

## v0.2.0 - 2026-06-01

+ [新增] 支持通过火山方舟AgentPlan接入。
+ [新增] 视频生成支持声音、水印及图片/视频/音频参考输入。
+ [新增] 画布新增音频节点。
+ [优化] 图片/视频素材支持 `图片1`编号注入提示词。

## v0.1.1 - 2026-05-30

+ [新增] 支持New API跳转并自动填入Base URL和API Key配置。

## v0.1.0 - 2026-05-26

+ [优化] 优化我的画布、我的素材导出功能
+ [修复] 修复画布撤销，配置节点等bug问题

## v0.0.9 - 2026-05-26

+ [新增] 新增视频创作台页面。
+ [修复] 修复图片节点size参数传递问题。

## v0.0.8 - 2026-05-24

+ [新增] 新增用户账号与算力点体系，支持账号密码注册登录、Linux.do OAuth。
+ [新增] 管理后台公开配置支持设置模型算力点、支持计费查询。
+ [新增] 画布右上角展示用户算力点余额，生成按钮会展示本次预计消耗算力点。
+ [新增] 新增视频生成节点。

## v0.0.7 - 2026-05-23

+ [新增] 管理后台提示词管理支持多选批量删除。
+ [新增] 新增定义拉取GitHub提示词源功能。
+ [新增] 新增awesome-gpt-image2-prompts提示词来源。
+ [优化] 优化模型下拉选择样式、优化生图编辑设置

## v0.0.6 - 2026-05-22

+ [新增] 管理后台支持配置模型渠道，前端当前无需鉴权即可直接使用后端渠道能力。
+ [优化] 统一整理后端错误提示、AI 代理、图片节点生成与重试、参考图缺失处理等细节。
+ [优化] 后端模型代理路径调整为 OpenAI 风格。

## v0.0.5 - 2026-05-20

+ [新增] 右上角版本号支持点击查看版本更新弹窗，展示当前版本、最新版本和按时间线整理的更新日志。
+ [新增] 设置弹窗支持配置系统提示词，AI 生图、编辑图和文本请求会自动携带。

## v0.0.4 - 2026-05-20

+ [调整] Docker 运行入口改为 Next.js 对外提供页面，`/api/*` 由 Next.js 代理到内部 Go 服务。
+ [修复] 文本复制在局域网 IP 访问时可能失败的问题。

## v0.0.3 - 2026-05-19

+ [修复] 更新 nanoid 依赖并修改 ID 生成方式，防止其他ip无法使用crypto模块导致的ID生成失败问题。

## v0.0.2 - 2026-05-19

+ [新增] 增加生图工作台功能，支持文生图、图生图、查看历史记录，并增加移动端适配。
+ [修复] 画布生成尺寸控件支持选择更多常用比例，并可直接输入自定义比例。
+ [修复] 生成配置节点恢复拖拽操作，避免面板控件拦截整块节点拖动。
+ [文档] 增加 Render 部署说明。

## v0.0.1 - 2026-05-19

+ [新增] 首次开源版本，包含无限画布能力：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
+ [新增] AI 创作能力：支持 OpenAI 兼容接口的文生图、图生图、参考图编辑和文本问答。
+ [新增] 画布助手能力：支持围绕选中节点和上游节点对话、生图，并把结果插回画布。
+ [新增] 提示词库能力：抓取多个 GitHub 开源项目，按案例整理数百个图片提示词。
