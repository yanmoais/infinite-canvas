import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button, Input, Modal, Segmented, Slider } from "antd";
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, ChevronDown, Frame, LockKeyhole, Maximize2, Move, ScanLine, ShieldCheck, Sparkles, WandSparkles, X } from "lucide-react";

import { calculateDownwardOutpaintGeometry, extendToFullBodyRatio, normalizeOutpaintDirection, suggestOutpaintDirection, suggestOutpaintMode } from "@/lib/canvas/canvas-outpaint-data";
import { canvasThemes } from "@/lib/canvas-theme";
import { sourceGenerationRecipeFromMetadata } from "@/lib/canvas/generation-plan";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasOutpaintDirection, CanvasOutpaintMode } from "@/types/canvas";

export type CanvasImageOutpaintPayload = {
    prompt: string;
    mode: CanvasOutpaintMode;
    direction: CanvasOutpaintDirection;
    extensionRatio: number;
    seamOverlapPixels: number;
    sourceScale: number;
    denoise: number;
};

const extendOptionsBase = [
    { label: "小幅续接", value: 0.35 },
    { label: "标准续接", value: 0.5 },
    { label: "大幅续接", value: 0.75 },
];

const fullBodyOptions = [
    { label: "标准全身 3:2", value: 0.75 },
    { label: "舒展全身", value: 1 },
    { label: "长幅上限", value: 1.15 },
];

const directionOptions: { value: CanvasOutpaintDirection; label: string; hint: string; icon: ReactNode }[] = [
    { value: "outward", label: "一键外扩", hint: "四边同时扩展，原图居中锁定", icon: <Maximize2 className="size-3.5" /> },
    { value: "up", label: "向上补全", hint: "补上方背景 / 天花板 / 天空（头已完整时不主动补头）", icon: <ArrowUpToLine className="size-3.5" /> },
    { value: "down", label: "向下补全", hint: "补腿 / 裙摆 / 地面", icon: <ArrowDownToLine className="size-3.5" /> },
    { value: "left", label: "向左扩展", hint: "补左侧身体与背景", icon: <ArrowLeftToLine className="size-3.5" /> },
    { value: "right", label: "向右扩展", hint: "补右侧身体与背景", icon: <ArrowRightToLine className="size-3.5" /> },
];

const fullBodyPrompt = "尽量保持同一个角色的脸型、五官、发型、发色和服装气质，广角远景全身立绘，完整看见从头到脚，直立站立，头部竖直不低头，正视镜头，面部完整清晰可见，双手自然背在身后，完整全身入镜，画面无裁切、无畸变。注意：本模式是软参考重生成，不保证像素级锁脸。";
const extendPromptByDirection: Record<CanvasOutpaintDirection, string> = {
    outward: "保持同一个角色和画面构图不变，自然向四周扩展背景与边缘内容，原图主体位置不动，接缝无痕，透视、光线和材质保持一致。",
    // 与引擎侧 up 默认词对齐：头已完整时只续场景，不主动写头部/发型/上半身，避免空白区再长实体
    up: "保持同一个角色和画面构图不变，自然向上延续墙面、天花板、天空或建筑等上方背景，头顶上方保持干净留白/场景空间，不要新增饰品或第二个人，接缝无痕，透视、光线和材质保持一致。",
    down: "保持同一个角色和画面构图完全不变，原图主体像素锁定，自然向下补全服装、身体、双脚与地面背景，接缝无痕，透视、光线和材质保持一致。适合近景/半身续接成全身。",
    left: "保持同一个角色和画面构图不变，自然向左扩展身体与背景，接缝无痕，透视、光线和材质保持一致。",
    right: "保持同一个角色和画面构图不变，自然向右扩展身体与背景，接缝无痕，透视、光线和材质保持一致。",
};

export function CanvasNodeOutpaintDialog({ node, open, onClose, onConfirm }: { node: CanvasNodeData | null; open: boolean; onClose: () => void; onConfirm: (payload: CanvasImageOutpaintPayload) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const sourceWidth = node?.metadata?.naturalWidth || Math.round(node?.width || 0);
    const sourceHeight = node?.metadata?.naturalHeight || Math.round(node?.height || 0);
    const suggestedMode: CanvasOutpaintMode = suggestOutpaintMode(sourceWidth, sourceHeight);
    const suggestedDirection: CanvasOutpaintDirection = suggestOutpaintDirection(sourceWidth, sourceHeight);
    const suggestedExtendRatio = sourceWidth && sourceHeight
        ? (sourceHeight / sourceWidth < 1.35 ? extendToFullBodyRatio(sourceWidth, sourceHeight) : 0.5)
        : 0.5;
    const [mode, setMode] = useState<CanvasOutpaintMode>(suggestedMode);
    const [direction, setDirection] = useState<CanvasOutpaintDirection>(suggestedDirection);
    const [prompt, setPrompt] = useState(extendPromptByDirection[suggestedDirection] || extendPromptByDirection.down);
    const [extensionRatio, setExtensionRatio] = useState(suggestedExtendRatio);
    const [seamOverlapPixels, setSeamOverlapPixels] = useState(96);
    const [sourceScale, setSourceScale] = useState(0.58);
    const [denoise, setDenoise] = useState(0.68);
    const [error, setError] = useState("");
    const sourceRecipe = useMemo(() => sourceGenerationRecipeFromMetadata(node?.metadata), [node?.metadata]);
    const extendOptions = useMemo(() => {
        const fullBodyRatio = sourceWidth && sourceHeight ? extendToFullBodyRatio(sourceWidth, sourceHeight) : 0.75;
        if (sourceWidth && sourceHeight && sourceHeight / sourceWidth < 1.45) {
            return [{ label: "续接成全身", value: fullBodyRatio }, ...extendOptionsBase];
        }
        return extendOptionsBase;
    }, [sourceHeight, sourceWidth]);
    const loraCount = sourceRecipe.loras?.length;
    const geometry = useMemo(() => {
        if (!sourceWidth || !sourceHeight) return null;
        try {
            return calculateDownwardOutpaintGeometry(sourceWidth, sourceHeight, {
                mode,
                direction,
                extensionRatio,
                seamOverlapPixels,
                sourceScale,
            });
        } catch {
            return null;
        }
    }, [direction, extensionRatio, mode, seamOverlapPixels, sourceHeight, sourceScale, sourceWidth]);

    useEffect(() => {
        if (!open) return;
        const nextMode: CanvasOutpaintMode = suggestOutpaintMode(sourceWidth, sourceHeight);
        const nextDirection: CanvasOutpaintDirection = suggestOutpaintDirection(sourceWidth, sourceHeight);
        const nextRatio = sourceWidth && sourceHeight
            ? (sourceHeight / sourceWidth < 1.35 ? extendToFullBodyRatio(sourceWidth, sourceHeight) : 0.5)
            : 0.5;
        setMode(nextMode);
        setDirection(nextDirection);
        setPrompt(nextMode === "full_body" ? fullBodyPrompt : extendPromptByDirection[nextDirection]);
        setExtensionRatio(nextMode === "full_body" ? 0.75 : nextRatio);
        setSeamOverlapPixels(nextMode === "full_body" ? 64 : 96);
        setSourceScale(0.58);
        setDenoise(nextMode === "full_body" ? 0.72 : 0.68);
        setError("");
    }, [node?.id, open, sourceHeight, sourceWidth]);

    const switchMode = (nextMode: CanvasOutpaintMode) => {
        setMode(nextMode);
        if (nextMode === "full_body") {
            setDirection("down");
            setPrompt(fullBodyPrompt);
            setExtensionRatio(0.75);
            setSeamOverlapPixels(64);
            setDenoise(0.72);
        } else {
            const nextDirection = normalizeOutpaintDirection(direction);
            const nextRatio = sourceWidth && sourceHeight && nextDirection === "down" && sourceHeight / sourceWidth < 1.35
                ? extendToFullBodyRatio(sourceWidth, sourceHeight)
                : 0.5;
            setDirection(nextDirection);
            setPrompt(extendPromptByDirection[nextDirection]);
            setExtensionRatio(nextRatio);
            setSeamOverlapPixels(96);
            setDenoise(0.68);
        }
        setError("");
    };

    const switchDirection = (nextDirection: CanvasOutpaintDirection) => {
        const normalized = normalizeOutpaintDirection(nextDirection);
        setDirection(normalized);
        if (mode === "extend") {
            setPrompt(extendPromptByDirection[normalized]);
            if (normalized === "down" && sourceWidth && sourceHeight && sourceHeight / sourceWidth < 1.35) {
                setExtensionRatio(extendToFullBodyRatio(sourceWidth, sourceHeight));
            } else if (normalized === "outward") {
                setExtensionRatio(0.5);
            }
        }
        setError("");
    };

    const submit = () => {
        const nextPrompt = prompt.trim();
        if (!nextPrompt) return setError("请输入希望补全的服装、姿势或背景要求");
        if (!geometry) return setError(mode === "full_body" ? "当前图片尺寸无法继续全身重构" : "当前图片尺寸无法继续原图续接");
        onConfirm({ prompt: nextPrompt, mode, direction: mode === "full_body" ? "down" : direction, extensionRatio, seamOverlapPixels, sourceScale, denoise });
    };

    const compactModel =
        sourceRecipe.model
            ?.split("::")
            .pop()
            ?.replace(/^comfy\//, "") || "历史配方未知";
    const recipeText = loraCount === undefined ? "LoRA 配方未知" : loraCount ? `继承 ${loraCount} 个 LoRA` : "源图未使用 LoRA";
    const directionMeta = directionOptions.find((item) => item.value === direction) || directionOptions[1];
    const directionLabel = directionMeta.label;
    const directionHint = directionMeta.hint;
    const directionVerb = direction === "outward" ? "向四周" : direction === "up" ? "向上" : direction === "left" ? "向左" : direction === "right" ? "向右" : "向下";

    return (
        <Modal title={null} open={open && Boolean(node?.metadata?.content)} onCancel={onClose} footer={null} width={920} centered destroyOnHidden styles={{ body: { maxHeight: "82vh", overflowY: "auto", padding: 24 } }}>
            <div style={{ color: theme.node.text }}>
                <header className="flex items-start gap-4 border-b pb-5" style={{ borderColor: theme.node.stroke }}>
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                        <Move className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-xl font-semibold tracking-tight">补全角色与画面</h2>
                            <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: theme.node.fill, color: theme.node.muted }}>
                                本地 ComfyUI 托管工作流
                            </span>
                        </div>
                        <p className="mt-1.5 max-w-2xl text-sm leading-6" style={{ color: theme.node.muted }}>
                            要完整锁住原图人物，请优先用“原图续接”（像素锁定，只生成新增区域）。“全身重构”是软参考重生成，脸/发/装可能漂移，适合只想换构图、不强制锁原图像素的情况。
                        </p>
                    </div>
                </header>

                <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_270px]">
                    <section className="min-w-0 space-y-5">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <ModeCard
                                active={mode === "extend"}
                                icon={<ScanLine className="size-4" />}
                                title="原图续接"
                                badge="完整锁人推荐"
                                description="原图主体像素锁定，只生成新增区域。支持一键四边外扩，或向上补头 / 向下续接成全身 / 左右扩展。近景要完整全身且要锁住原脸，优先选这个。"
                                theme={theme}
                                onClick={() => switchMode("extend")}
                            />
                            <ModeCard
                                active={mode === "full_body"}
                                icon={<Frame className="size-4" />}
                                title="全身重构"
                                badge="软参考重生成"
                                description="EmptyLatent 重新构图生成站姿全身，只 soft 借脸/发/装气质，不保证像素级锁脸。适合接受角色漂移、只想快速出全身构图的情况。"
                                theme={theme}
                                onClick={() => switchMode("full_body")}
                            />
                        </div>

                        {mode === "extend" ? (
                            <div className="rounded-2xl border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold">续接方向</div>
                                        <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                                            先选要补的方向。主体位置不动，只有该方向新增区域会生成。
                                        </div>
                                    </div>
                                    <span className="shrink-0 text-xs font-medium" style={{ color: theme.node.muted }}>
                                        {directionHint}
                                    </span>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                    {directionOptions.map((item) => {
                                        const active = direction === item.value;
                                        return (
                                            <button
                                                key={item.value}
                                                type="button"
                                                className="min-h-[72px] rounded-xl border px-2.5 py-2.5 text-left transition"
                                                style={{
                                                    borderColor: active ? theme.node.activeStroke : theme.node.stroke,
                                                    background: active ? theme.toolbar.activeBg : theme.node.fill,
                                                    boxShadow: active ? `inset 0 0 0 1px ${theme.node.activeStroke}` : "none",
                                                }}
                                                onClick={() => switchDirection(item.value)}
                                            >
                                                <div className="flex items-center gap-1.5 text-xs font-semibold">
                                                    {item.icon}
                                                    {item.label}
                                                </div>
                                                <div className="mt-1.5 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                                                    {item.hint}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}

                        <div className="rounded-2xl border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold">输出画幅</div>
                                    <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                                        {mode === "full_body" ? "按全身入镜竖图比例重生成，默认约 3:2（软参考，不锁原图像素）" : direction === "down" && sourceWidth && sourceHeight && sourceHeight / sourceWidth < 1.35 ? `在原图基础上向下扩展到全身竖图（约 1.5~1.75），主体像素锁定` : `在原图基础上${directionVerb}增加画面，主体像素锁定`}
                                    </div>
                                </div>
                                <span className="shrink-0 text-sm font-semibold tabular-nums">{geometry ? `${geometry.targetWidth} × ${geometry.targetHeight}` : "不可用"}</span>
                            </div>
                            <Segmented className="mt-4" block value={extensionRatio} options={mode === "full_body" ? fullBodyOptions : extendOptions} onChange={(value) => setExtensionRatio(Number(value))} />
                        </div>

                        <div className="space-y-2">
                            <div className="flex flex-wrap items-end justify-between gap-2">
                                <div>
                                    <div className="text-sm font-semibold">画面要求</div>
                                    <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                                        可以直接写中文；提交前会统一整理为英文提示词，不再出现中英混排。
                                    </div>
                                </div>
                                <span className="text-[11px]" style={{ color: theme.node.faint }}>
                                    {mode === "full_body" ? "重点写服装、姿势、背景和必须完整入镜的部位" : "重点写该方向要补出的内容，以及必须保持不变的角色与构图"}
                                </span>
                            </div>
                            <Input.TextArea
                                rows={5}
                                value={prompt}
                                status={error && !prompt.trim() ? "error" : undefined}
                                placeholder={mode === "full_body" ? "例如：保持同一个角色和白色连衣裙，镜头拉远，完整显示双腿和双脚，直立正视站在庭院中。" : direction === "outward" ? "例如：保持同一个角色和构图，自然向四周扩展背景与边缘，接缝无痕。" : direction === "up" ? "例如：保持同一个角色和构图，自然向上延续天花板/墙面/天空背景，头顶上方干净，接缝无痕。" : direction === "down" ? "例如：保持同一个角色和白色连衣裙，自然补全双腿与双脚，站立在庭院中。" : "例如：保持同一个角色和白色连衣裙，自然扩展画面边缘与背景，接缝无痕。"}
                                onChange={(event) => {
                                    setPrompt(event.target.value);
                                    setError("");
                                }}
                            />
                            {error ? <div className="text-xs font-medium text-red-500">{error}</div> : null}
                        </div>

                        <details className="group rounded-2xl border" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold">
                                <span className="flex items-center gap-2">
                                    <Sparkles className="size-4" />
                                    高级控制
                                </span>
                                <ChevronDown className="size-4 transition group-open:rotate-180" />
                            </summary>
                            <div className="space-y-5 border-t px-4 pb-4 pt-4" style={{ borderColor: theme.node.stroke }}>
                                {mode === "full_body" ? (
                                    <div className="rounded-xl border p-3 text-xs leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}>
                                        全身重构主图优先保证完整构图（头脚入镜），身份靠文字锚 + 生成后脸部精修；画幅固定为全身竖图比例（约 1.5~1.75），请优先选“标准全身”。
                                    </div>
                                ) : (
                                    <>
                                        <div className="rounded-xl border p-3 text-xs leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}>
                                            原图续接使用「蒙版局部重绘 + 非接缝区像素回贴」。主体位置完全不动。近景/半身要全身且要锁脸：选向下补全 +「续接成全身」。只有接受角色漂移时才用全身重构。
                                        </div>
                                        <SettingSlider
                                            label="边缘融合"
                                            valueText={`${seamOverlapPixels}px`}
                                            description="允许模型重绘原图接缝处的一小段区域，让新增内容自然接上。"
                                            min={32}
                                            max={160}
                                            step={8}
                                            value={seamOverlapPixels}
                                            onChange={setSeamOverlapPixels}
                                            theme={theme}
                                        />
                                        <SettingSlider
                                            label="画面改动幅度"
                                            valueText={denoise.toFixed(2)}
                                            description="标准续接建议 0.62–0.75；过高会把接缝内侧也改花。"
                                            min={0.5}
                                            max={0.9}
                                            step={0.02}
                                            value={denoise}
                                            onChange={setDenoise}
                                            theme={theme}
                                        />
                                    </>
                                )}
                            </div>
                        </details>
                    </section>

                    <aside className="h-fit rounded-2xl border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <ShieldCheck className="size-4" />
                            本次会怎样处理
                        </div>
                        <div className="mt-4 space-y-3">
                            <PlanLine label="原图" value={sourceWidth && sourceHeight ? `${sourceWidth} × ${sourceHeight}` : "读取中"} />
                            <PlanLine label="方式" value={mode === "full_body" ? "soft 角色参考全身重生成（不保证锁脸）" : `${directionLabel} · 蒙版局部重绘 + 像素回贴`} />
                            <PlanLine label="角色保持" value={mode === "full_body" ? "soft IPAdapter 气质参考（非像素锁）" : "原图非接缝区域像素锁定"} />
                            {mode === "extend" ? <PlanLine label="扩展内容" value={directionHint} /> : null}
                            <PlanLine label="模型" value={compactModel} />
                            <PlanLine label="增强组件" value={recipeText} />
                            <PlanLine label="提示词" value="中文输入 → 英文单语提交" />
                        </div>

                        <div className="mt-4 rounded-xl border p-3 text-xs leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}>
                            <div className="flex items-start gap-2">
                                <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
                                <span>{mode === "full_body" ? "全身重构无法像素锁人：soft IPAdapter + EmptyLatent 重生成，脸/发/装可能漂移。要完整锁住请改用原图续接。" : "原图主体像素锁定不会移动。近景变全身优先向下「续接成全身」；需要四边一起扩时用一键外扩。"}</span>
                            </div>
                        </div>

                        <details className="mt-3 text-xs" style={{ color: theme.node.muted }}>
                            <summary className="cursor-pointer font-medium" style={{ color: theme.node.text }}>
                                这些配置是什么意思？
                            </summary>
                            <div className="mt-2 space-y-2 leading-5">
                                <p>模型与 LoRA：自动继承源图配方，避免画风突然变化。</p>
                                <p>全身重构：主图 soft 参考 + EmptyLatent 重生成，不保证锁脸；FaceDetailer 关闭。</p>
                                <p>原图续接：蒙版局部重绘 + 像素回贴；支持一键外扩（四边）或单方向补全。</p>
                            </div>
                        </details>
                    </aside>
                </div>

                <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: theme.node.stroke }}>
                    <div className="text-xs" style={{ color: theme.node.muted }}>
                        {mode === "full_body" ? "建议生成后检查：头是否完整入镜、双脚是否可见、腿长是否正常、裙摆是否保持。" : `建议生成后检查：${directionHint}是否补全、接缝是否自然、原图主体是否保持不动。`}
                    </div>
                    <div className="flex gap-2">
                        <Button icon={<X className="size-4" />} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" icon={<WandSparkles className="size-4" />} onClick={submit}>
                            {mode === "full_body" ? "开始生成完整全身" : `开始${directionLabel}`}
                        </Button>
                    </div>
                </footer>
            </div>
        </Modal>
    );
}

function ModeCard({ active, icon, title, badge, description, theme, onClick }: { active: boolean; icon: ReactNode; title: string; badge?: string; description: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClick: () => void }) {
    return (
        <button
            type="button"
            className="min-h-32 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5"
            style={{
                borderColor: active ? theme.node.activeStroke : theme.node.stroke,
                background: active ? theme.toolbar.activeBg : theme.node.fill,
                boxShadow: active ? `inset 0 0 0 1px ${theme.node.activeStroke}` : "none",
            }}
            onClick={onClick}
        >
            <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-xl" style={{ background: theme.node.panel }}>
                    {icon}
                </span>
                <span className="font-semibold">{title}</span>
                {badge ? (
                    <span className="ml-auto rounded-full px-2 py-1 text-[10px] font-medium" style={{ background: theme.node.panel, color: theme.node.muted }}>
                        {badge}
                    </span>
                ) : null}
            </div>
            <p className="mt-3 text-xs leading-5" style={{ color: theme.node.muted }}>
                {description}
            </p>
        </button>
    );
}

function SettingSlider({
    label,
    valueText,
    description,
    min,
    max,
    step,
    value,
    onChange,
    theme,
}: {
    label: string;
    valueText: string;
    description: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
}) {
    return (
        <div>
            <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-xs tabular-nums" style={{ color: theme.node.muted }}>
                    {valueText}
                </div>
            </div>
            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                {description}
            </div>
            <Slider className="mt-3" min={min} max={max} step={step} value={value} onChange={onChange} />
        </div>
    );
}

function PlanLine({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-3 text-xs">
            <span style={{ color: "inherit", opacity: 0.72 }}>{label}</span>
            <span className="max-w-[60%] text-right font-medium leading-5">{value}</span>
        </div>
    );
}
