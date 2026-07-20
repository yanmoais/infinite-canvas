# Gate A / U1-R0-P 真实 manifest 冻结证据

## 范围

基于 C0-6/C0-Z 合同，将 U1-R0 首轮 18 cells / 9 pairs 的真实资产 SHA、compiled prompt、workflow/mutator/code 指纹写入：

`.uat/u1-outpaint/u1-r0/manifest.json`（`status=FROZEN`）

**不**提交 GPU 18 cells；仅完成预注册冻结门。

## 冻结来源

| 字段 | 来源 |
|---|---|
| source | `.uat/u1-outpaint/baseline/u1-character-baseline.png` |
| checkpoint 物理 SHA | Windows 挂载 `illustriousxlMmmix_v80.safetensors` |
| A 组 6 LoRA 物理 SHA + strength | Windows LoRA 文件 + U1-A 实跑 workflow / registry defaults |
| 每方向 compiled pos/neg | U1-A five-dir 结果图 PNG `prompt` 元数据（含 densify 后全文） |
| sampler/scheduler/steps/cfg | U1-A 实跑 `euler_ancestral / normal / 28 / 7.5` |
| denoise/seam/extensionRatio | U1-A five-dir 与 template 首轮值 |
| base/mask | U1-A five-dir 已准备 canvas：`u1a-*-base-*.png` / `u1a-*-mask-*.png` |
| pad | 当前链路 pad 融于 prepared base；`pad.sha256 = base.sha256` 并显式标注 |
| workflow | `illustrious-simple-api.json`，binding `comfy.image.illustrious-mmmix-v8:txt2img_template` |
| mutator | `canvas_inpaint`；version = gateway 函数体 SHA-256 |
| codeFingerprint | commit `c5da6db…`；tracked worktree diff empty |

## 关键指纹

| 对象 | SHA-256 |
|---|---|
| source | `e42321da229f440ffe100df64a4080dbba719ba9b7e2b4813fa7d9d01ab36b80` |
| checkpoint | `8c1a5bdbe65fb3a8dfe6dbfd0116f9f7194d283176ad6123ea5e95b6ce051e76` |
| workflow `illustrious-simple-api.json` | `eed3161add63103d07c01a5dde7298a4fbe79a4ee04f43bf96a0097e2c670073` |
| `canvas_inpaint` mutator body | `3db815a209e9d9175e6238a535ca4ad01cb6a2d6bef5cb406eadf7f5c8fc3c5d` |
| model-registry.json | `524e55f6835375814ed752a7b7fc2145bab4054a9e4b5f2675562c7b8fbe4581` |

A 组 LoRA（顺序固定）：

1. `illustrious-masterpiece-v3` 0.65/0.65  
2. `bss-detail-enhancer-v3` 0.7/0.7  
3. `bss-visual-enhancer-v3` 1.0/1.0  
4. `bss-skin-texture-v2` 0.6/0.6  
5. `eyes-for-illustrious` 0.6/0.6  
6. `dramatic-lighting-slider` 1.5/1.5  

B 组：`loras=[]`。

## 校验

- Ajv draft-2020-12 `manifest.schema.json`：`schema_ok true`
- `validateFrozenManifestSemantics(manifest)`：`0 issues`
- TS `requestSha256FromHashInput` 复算前 4 cells：sha/jcs 均 match
- 9 pairs `validateAbRequestHashInputDiff`：仅 LoRA 差异

## 状态

- U1-R0-P = `DONE`（真实 manifest 已冻结）
- U1-R0 实验 = `READY`（可提交 18 cells；仍须 B 侧 complete 空 LoRA 回执）
- Gate A = `IN_PROGRESS`
- 未改 Mission_manager / Windows ComfyUI；未自动开跑 GPU

## 开跑约束

1. 禁止修改本 `manifest.json` 后继续使用同一 `manifestId`。  
2. 每 cell 请求必须复现对应 `requestHashInput`。  
3. B cell selected receipt 必须 `actualLoras=[]` 且 `loraEvidence.status=complete`。  
4. Fooocus / IPAdapter / ControlNet / FaceDetailer / prompt rewrite 禁止进入本矩阵。
