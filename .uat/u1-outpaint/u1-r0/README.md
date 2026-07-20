# U1-R0 目录

Illustrious 裸模 A/B 归因实验的**合同与预注册骨架**。

## 当前状态

| 文件 | 状态 |
|---|---|
| `schemas/*` | ✅ 已落盘（C0-6） |
| `taxonomy.profile.json` | ✅ 已落盘 |
| `manifest.template.json` | ✅ 模板；`status=TEMPLATE` |
| `manifest.json` | ❌ 未创建（真实资产 SHA 冻结后才生成） |
| 18 cells 结果 | ❌ 禁止在真实 manifest 冻结前开跑 |

## 权威文档

- 专项合同：`docs/u1-r0-execution-contract.md`
- 总控入口：`docs/infinite-canvas-unified-development-plan.md` §5.2 / C0-6
- 空 LoRA 协议证据：`.uat/gate-0/c0-3-receipt-v2/`（bare `5d440fec…`）
- 离线合同测试：`web/tests/u1-r0-contract.test.ts`
- 纯函数：`web/src/lib/canvas/u1-r0-contract.ts`

## 开跑前必须

1. 从 template 生成 `manifest.json`，填齐全部 source/checkpoint/LoRA/pad-mask/workflow/code SHA。  
2. 为每个 cell 写入 `requestHashInput`、`requestHashInputJcsUtf8Base64`、`requestSha256`。  
3. A/B 结构化 diff 仅允许 LoRA 集合差异。  
4. B 组每个 selected attempt 的 receipt 满足 `actualLoras=[]` 且 `loraEvidence.status=complete`。  
5. 将 manifest `status` 置为 `FROZEN` 后再提交 GPU。

## 禁止

- 把 `manifest.template.json` 当冻结实验配置。  
- 用历史 A2R2 或仅请求级 `lora_keys=[]` 声称裸模已证明。  
- 引入 Fooocus / IPAdapter / ControlNet / FaceDetailer / prompt rewrite 到 U1-R0 链路。
