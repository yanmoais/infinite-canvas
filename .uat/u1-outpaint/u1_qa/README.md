# U1-QA

结构化 Outpaint 验收工具（Gate A / U1）。

## 作用

对单个方向或 U1-A 五方向矩阵：

1. 按 `request.json.geometry` 生成 **lossless PNG crops**（seam / extension / far / corners）
2. 计算 **metrics**（含 `protectedCoreDiffRatio`、`seamContinuity`、空间化 `void_dark`、相对色偏）
3. 用显式阈值输出 `METRIC_FAIL` / `WARN` / `PASS_PENDING_VISUAL`
4. 写出 `qa-report.json`（schema + auto findings + 待人工/VLM 标签）

## 用法

```bash
# 五方向矩阵
python3 .uat/u1-outpaint/u1_qa/u1_qa.py \
  --matrix-root .uat/u1-outpaint/u1a-five-dir

# 单方向
python3 .uat/u1-outpaint/u1_qa/u1_qa.py \
  --case-dir .uat/u1-outpaint/u1a-five-dir/u1a-up
```

## 产物

每个 `u1a-{dir}/`：

| 文件 | 说明 |
|---|---|
| `qa-crops/*.png` | geometry 驱动裁切（PNG） |
| `metrics.qa.json` | 完整 QA metrics |
| `metrics.json` | 兼容旧字段 + QA 扩展 |
| `qa-report.json` | 结构化 finding / verdict |

矩阵根目录：

| 文件 | 说明 |
|---|---|
| `u1-qa-summary.json` | 五方向汇总 |

阈值：`threshold_profile_v1.json`。

## 边界

- `METRIC_PASS` **不是**产品通过，只是粗筛。
- `second_subject` / `camera_prop` / `anatomy_break` / `identity_drift` / `bg_incoherent` 在 v1 仅占位，需人工或 VLM 填 region+crop。
- 不替代 BOSS 终验（U1-Z）。
