# Gate 0 / C0-3 LoRA 证据合同冻结基线

> receipt v2 已加载到共享 `127.0.0.1:8080`；核心在线合同、可复算 HTTP/持久化证据、planned/actual preset 路由与三项共享指纹均已核对，C0-3 按既有出口闭环。FaceID 与多阶段编辑的真实 Windows 运行验证仍属于 Gate B，不倒灌为 C0-3 阻塞项。

## 1. Receipt v2 合同

- `stages[].actualLoras` 从 `workflow_mutator` 执行后的最终 ComfyUI workflow 反向枚举，只记录可达 `SaveImage` / `PreviewImage` 输出路径上的显式 LoRA 节点。
- 显式 `LoraLoader` / `LoraLoaderModelOnly` 记录 `file`、`nodeId`、`loaderClass`、来源和 model/clip strength；Gateway 动态插入节点标记为 `gateway_dynamic`，模板既有节点标记为 `workflow_template`。
- `loraEvidence.status=complete` 表示当前执行图上的 LoRA 来源已完整列举；仅当该状态成立时，空 `actualLoras` 才能证明该阶段实际空 LoRA。
- FaceID 等自定义 loader 内部可能管理 LoRA，无法从 workflow 字面完整枚举时记录 `opaqueSources`，状态为 `incomplete`。
- 失败发生在最终 workflow 证据形成前，或找不到输出执行路径时，状态为 `unknown`，不得将空数组解释为裸模证据。
- 顶层 `actual` 保留最终阶段路由字段，但 `actualLoras` 和 `loraEvidence` 聚合全部阶段；聚合优先级为 `unknown > incomplete > complete`，LoRA 条目保留 `stageIds`。
- `planned.baseCapabilityId` 保留请求侧 preset；`stages[].baseCapabilityId` / `actual.baseCapabilityId` 使用最终实际 preset。若请求 preset 被服务端替换，则 `fallback.used=true` 且 `fallback.preset={from,to,reason}`；reference-mode fallback 语义不变。
- 前端只接受 `schemaVersion: "2"` 并深校验 LoRA 证据与 preset fallback 一致性。旧 receipt v1 保留图片，但不作为可信执行回执附着。

## 2. 冻结指纹

| 对象 | SHA-256 |
|---|---|
| Registry | `a0ff5c208184e8bf0234de19c73ae20c6ff4bbdf6877d8f2c14eea50da8cea29` |
| Gateway 源文件 | `83a76738797d8a2f55eab349deeab02f3c2e5501e81966dc505b6d9fd5c8659c` |
| Workflow 集合 | `c0c4e4295e2a2d98eff5d3363fd7f54ff704050545384ac4d84fa93e0d8667e9` |

Workflow 集合按 `gate-0-convergence-snapshot.md` 的算法独立复算：`scripts/local-image/workflows` 下实际为 71 个 JSON；绝对路径按 byte 排序；逐文件执行 `shasum -a 256`；清单每行严格为 `<hash><两个 ASCII 空格><绝对路径><LF>`，并保留最后一行 LF；清单共 12049 bytes，整体 SHA-256 为上表 `c0c4e429…`。33 文件算法得到的 `821586…` 不属于本冻结基线，不得使用。

Gateway 哈希相对 C0-2 候选基线已变化，因为 C0-3 为修正 P1-2 最小实现了 planned/actual preset 分离与 `fallback.preset`。Registry 与 Workflow 未改，仍命中冻结值。当前共享 Gateway 进程 PID `98863` 加载的正是上述 Gateway 源文件。

## 3. 可复算证据目录

权威可复算证据目录：

- [`.uat/gate-0/c0-3-receipt-v2/evidence-manifest.json`](../.uat/gate-0/c0-3-receipt-v2/evidence-manifest.json)
- manifest SHA-256：`272a11214cb8b33c4d62a61152ef7142b286f519e0f529ddb9323b93100b9f54`

每个样本都保存 `request.json`、`response.json`、`status.json`、`persisted-receipt.json`。canonical JSON 算法为：

```text
json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8') then SHA-256
```

对每个样本比较 `response.execution_receipt` 与持久化 receipt 的 canonical SHA-256；四类样本均为 `responseReceiptEqualsPersistedReceipt=true`。

旧 receipt `a2fc1bcd…` / `cacf99dd…` / `eef0ae0d…` / `df9bad3a…` 仅作历史操作记录：它们当时人工核对过字段，但未冻结 HTTP 原始 request/response，**不能**作为当前可独立复算冻结证据，已被本目录新样本取代。

## 4. 核心在线证据

| 场景 | Receipt | 在线结果 | 结论 |
|---|---|---|---|
| bare / 请求无 `lora_keys` | `5d440fec-1ab0-49da-941e-1d694a43069d` | HTTP 200；schema 2、`succeeded`、`actualLoras=[]`、`loraEvidence.status=complete`；request `extra` 不含 `lora_keys` 字段 | 最终可达执行图完整证明实际空 LoRA；request 边界可复算 |
| 动态 LoRA | `759df4cb-3eb0-4e8a-9bfd-d590699abc6c` | HTTP 200；schema 2、`succeeded`；`bss_detail_enhancer_v3.safetensors`、node `10`、`LoraLoader`、`gateway_dynamic`、model/clip `0.7/0.7`；顶层 `stageIds=["primary"]`；`complete` | 动态插入 LoRA 的文件、节点、来源、强度和阶段聚合均符合合同 |
| build-workflow 前真实失败 | `7603dcac-adea-4910-a507-a0a4af6ca15c` | HTTP 500；`Image preset has no txt2img template: zimage-union-controlnet`；schema 2、`failed`、`promptId=null`、`actualLoras=[]`、`loraEvidence.status=unknown`，opaque reason 为 `final_workflow_not_observed` | 安全轻量探针在模板检查处失败，发生于 ComfyUI `/prompt` 之前，没有提交 GPU；空数组未被误报为裸模证据 |
| invalid preset 回退 | `ad748509-de69-40eb-9e1f-b46bbae8efe4` | HTTP 200；`planned.baseCapabilityId=comfy.image.not-a-real-preset`；`stage/actual.baseCapabilityId=comfy.image.wai`；`fallback.used=true` 且 `fallback.preset={from:not-a-real-preset,to:wai,reason:requested_preset_unavailable}`；`actualLoras=[] + complete` | 成功回退样本，不是 `unknown`；planned/actual 路由与 preset fallback 元数据可归因 |

四类样本的 HTTP receipt 与 `logs/local-agent/generation-receipts/<receiptId>.json` 及证据目录副本内容一致。失败探针使用已启用但仅有 ControlNet 模板的 `zimage-union-controlnet`，以 `reference_mode=none` 请求其不存在的 `txt2img_template`。

## 5. 静态覆盖与 Gate B 边界

- Gateway 静态测试已覆盖：最终 workflow 形成前的 `unknown`、提交后的失败仍保留 workflow LoRA 证据、FaceID opaque loader 导致 `incomplete`、多阶段 LoRA 聚合、FaceID → fallback 的成功/失败阶段保留，以及 invalid preset 的 planned/actual/`fallback.preset` 合同。
- 前端静态测试已覆盖 schema v2、LoRA 字段深校验、伪造 `complete`、非法 `stageIds`、失败 stage 与 preset fallback 正负例。
- 本次按任务约束不运行 build/test；上述内容是既有/已写入测试的静态覆盖边界，不冒充本轮重新跑测结果。
- C0-3 的核心在线门只要求验证可证明空 LoRA、显式动态 LoRA、真实 pre-submit `unknown`、HTTP/持久化可复算一致性和冻结指纹，现已全部满足；preset fallback 路由修正是 P1 闭环必要项。
- FaceID opaque/incomplete 与多阶段/回退虽有静态合同覆盖，但其 live Windows 编辑链仍留 Gate B，与 mask/inpaint、framing retry、part refine 一并取证；`registered` 也不等同于届时重新计算过 Windows 物理资产哈希。

## 6. 出口判断

C0-3 结论为 `DONE`：receipt v2 已由共享 Gateway 实际加载；核心成功/失败在线合同与 planned/actual preset fallback 合同通过；HTTP/持久化一致性可通过 `.uat/gate-0/c0-3-receipt-v2/` 独立复算；Registry、Gateway 和 71-workflow 集合指纹已冻结。C0-4 仅因此解除前置阻塞，本次未实施 C0-4，也未启动 Gate A 或 Gate B。
