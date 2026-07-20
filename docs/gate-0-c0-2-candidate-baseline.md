# Gate 0 / C0-2 Gateway 纠偏候选基线

> 记录时间：2026-07-18。本文只记录 C0-2 候选代码与静态证据，不是 C0-3 最终运行时冻结；Gate 状态以 `docs/infinite-canvas-unified-development-plan.md` 为唯一权威。

## 1. 纠偏结果

| 范围 | 结果 |
|---|---|
| Registry 历史结论 | 两个 Illustrious Outpaint 失败 profile 的 notes 已改为请求级观察，明确旧 receipt 缺少 `actualLoras` completeness，不能判定或排除 LoRA 因果 |
| Profile 状态 | 两个 profile 的 key、`enabled:false`、status、LoRA 集合和 managed denoise 均未改变 |
| 前端过滤 | presets 解析和 `recommendedLoraProfiles()` 均排除显式 `enabled:false`；缺字段仍按历史兼容视为 enabled |
| Gateway 保护 | 自动选择继续跳过 disabled；显式请求 disabled profile 返回 `409 / disabled_operation_profile`，且在生成前终止 |
| 裸跑入口 | 独立“裸跑”按钮保留，不依赖空 LoRA profile 出现在推荐列表 |

## 2. 改动与候选指纹

| 对象 | 候选 SHA-256 / 文件 |
|---|---|
| Registry | `a0ff5c208184e8bf0234de19c73ae20c6ff4bbdf6877d8f2c14eea50da8cea29` |
| Gateway 源文件 | `4140b564bd47181e6c05ca9a244132267da506cdcc85c693b95abbd9ef935555` |
| Workflow 集合 | 未修改；沿用 C0-1 集合指纹 `c0c4e4295e2a2d98eff5d3363fd7f54ff704050545384ac4d84fa93e0d8667e9` |
| 主线前端 | `web/src/services/api/comfy.ts` |
| 主线回归 | `web/tests/comfy-capabilities.test.ts` |
| Gateway 回归 | `scripts/local-agent/test_pose_control_contract.py` |

## 3. 验证边界

- Registry JSON 解析通过。
- 主线与 Mission_manager 相关文件 `git diff --check` 通过。
- 独立 reviewer 结论：`PASS`，Blocking 0、P0 0、P1 0。
- 按项目规则未运行单测、typecheck 或 build。
- 未提交生成请求，未重启或替换共享 8080。

## 4. 运行时状态

共享 `127.0.0.1:8080` 仍由原 PID `94507` 监听：

- Registry 是热读文件，因此新 notes 会被后续 presets 请求读取。
- Gateway Python 源码候选尚未加载进 PID `94507`；`409 / disabled_operation_profile` 必须在 C0-3 受控重启后验证。
- 本文中的 SHA 是磁盘候选指纹，不是已验证的最终运行时快照。

## 5. C0-2 出口

错误结论、前端传播路径和显式 disabled 执行入口都已在候选代码中纠正，C0-2 可以关闭。C0-3 负责：补齐 `actualLoras` 与 completeness 证据合同、执行约定验证、受控加载 Gateway 候选，并在验证后最终冻结 Registry、Workflow、Gateway 与资产快照。
