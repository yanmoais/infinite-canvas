# U1-R0 目录

Illustrious 裸模 A/B 归因实验的**合同与预注册骨架**。

## 当前状态

| 文件 | 状态 |
|---|---|
| `schemas/*` | ✅ 已落盘（C0-6） |
| `taxonomy.profile.json` | ✅ 已落盘 |
| `manifest.template.json` | ✅ 模板；`status=TEMPLATE` |
| `manifest.json` | ✅ **FROZEN**（U1-R0-P 真实预注册完成） |
| 18 cells 结果 | ❌ 尚未提交；仅允许基于本冻结 manifest 开跑 |

## 权威文档

- 专项合同：`docs/u1-r0-execution-contract.md`
- 总控入口：`docs/infinite-canvas-unified-development-plan.md` §5.2 / Gate A
- 空 LoRA 协议证据：`.uat/gate-0/c0-3-receipt-v2/`（bare `5d440fec…`）
- 离线合同测试：`web/tests/u1-r0-contract.test.ts`
- 纯函数：`web/src/lib/canvas/u1-r0-contract.ts`
- 预注册证据：`docs/gate-a-u1-r0-p-manifest-freeze.md`

## 冻结校验

```bash
# schema + validateFrozenManifestSemantics 必须 PASS
cd web && npx tsx /path/to/validate-script
```

本轮冻结已通过：Ajv draft-2020-12 schema ✅；`validateFrozenManifestSemantics` 0 issues ✅。

## 开跑前必须

1. 只使用本目录 `manifest.json`（`status=FROZEN`），禁止改参后继续用同一 `manifestId`。  
2. A/B 结构化 diff 仅允许 LoRA 集合差异。  
3. B 组每个 selected attempt 的 receipt 满足 `actualLoras=[]` 且 `loraEvidence.status=complete`。  
4. incomplete / unknown 空 LoRA 不得当作裸模证据。

## 禁止

- 把 `manifest.template.json` 当冻结实验配置。  
- 用历史 A2R2 或仅请求级 `lora_keys=[]` 声称裸模已证明。  
- 引入 Fooocus / IPAdapter / ControlNet / FaceDetailer / prompt rewrite 到 U1-R0 链路。
