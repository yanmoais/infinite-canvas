import { useEffect, useMemo, useState } from "react";
import { Button, Input, Modal, Popover, Tooltip } from "antd";
import { Grid2x2, Heart, Layers3, Loader2, Sparkles, Star } from "lucide-react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import {
    bumpPresetUsage,
    comfyPresetKey,
    fetchComfyPresets,
    fetchLikedPresets,
    isComfyModel,
    presetUsageCount,
    saveLikedPresets,
    type ComfyImagePreset,
    type ComfyPresets,
} from "@/services/api/comfy";

type CanvasModelBrowserProps = {
    config: AiConfig;
    model: string;
    onSelect: (model: string) => void;
};

type BrowserCard = ComfyImagePreset & { modelValue: string; liked: boolean; usage: number };
type FilterItem = {
    key: string;
    label: string;
    count: number;
    kind: "all" | "liked" | "family";
};

const FAMILY_ACCENTS: Record<string, string> = {
    sdxl: "#38bdf8",
    sd15: "#a78bfa",
    anima: "#fb7185",
    zimage: "#34d399",
    qwen_image: "#fbbf24",
    qwen_image_edit: "#f59e0b",
    post_process: "#94a3b8",
    vision_caption: "#c084fc",
};

function familyAccent(family: string) {
    const key = family.toLowerCase().replace(/\s+/g, "_");
    return FAMILY_ACCENTS[key] || "#a8a29e";
}

function familyLabel(family: string) {
    const map: Record<string, string> = {
        sdxl: "SDXL",
        sd15: "SD1.5",
        anima: "Anima",
        zimage: "Z-Image",
        qwen_image: "Qwen Image",
        qwen_image_edit: "Qwen Edit",
        post_process: "后处理",
        vision_caption: "视觉理解",
    };
    return map[family.toLowerCase()] || family;
}

export function CanvasModelBrowser({ config, model, onSelect }: CanvasModelBrowserProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false);
    const [presets, setPresets] = useState<ComfyPresets | null>(null);
    const [liked, setLiked] = useState<Set<string>>(new Set());
    const [loadError, setLoadError] = useState("");
    const [filter, setFilter] = useState("all");
    const [query, setQuery] = useState("");

    const comfyModelValues = useMemo(() => {
        const values = new Map<string, string>();
        for (const value of selectableModelsByCapability(config, "image")) {
            if (isComfyModel(value)) values.set(comfyPresetKey(value), value);
        }
        return values;
    }, [config]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoadError("");
        // 当前可能是 chatgpt-login / 云端模型；档案接口必须走 comfy/nannan 网关，不能用当前生图渠道
        const referenceModel = (isComfyModel(model) ? model : "") || comfyModelValues.values().next().value || model || "";
        Promise.all([
            fetchComfyPresets(config, referenceModel),
            fetchLikedPresets(config, referenceModel).catch(() => new Set<string>()),
        ])
            .then(([nextPresets, nextLiked]) => {
                if (cancelled) return;
                setPresets(nextPresets);
                setLiked(nextLiked);
            })
            .catch((error) => {
                if (cancelled) return;
                setLoadError(error instanceof Error ? error.message : "读取本地模型失败");
            });
        return () => {
            cancelled = true;
        };
    }, [comfyModelValues, config, model, open]);

    const cards = useMemo<BrowserCard[]>(() => {
        if (!presets) return [];
        return Object.values(presets.imagePresets)
            .filter((preset) => comfyModelValues.has(preset.key))
            .map((preset) => ({
                ...preset,
                modelValue: comfyModelValues.get(preset.key) || "",
                liked: liked.has(`image:${preset.key}`),
                usage: presetUsageCount(preset.key),
            }));
    }, [comfyModelValues, liked, presets]);

    const filterItems = useMemo<FilterItem[]>(() => {
        const counts = new Map<string, number>();
        let likedCount = 0;
        for (const card of cards) {
            const family = card.family || "其他";
            counts.set(family, (counts.get(family) || 0) + 1);
            if (card.liked) likedCount += 1;
        }
        const families = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([family, count]) => ({
                key: family,
                label: familyLabel(family),
                count,
                kind: "family" as const,
            }));
        return [
            { key: "all", label: "全部", count: cards.length, kind: "all" },
            { key: "liked", label: "收藏", count: likedCount, kind: "liked" },
            ...families,
        ];
    }, [cards]);

    const visibleCards = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return cards
            .filter((card) => (filter === "all" ? true : filter === "liked" ? card.liked : (card.family || "其他") === filter))
            .filter((card) => (keyword ? `${card.key} ${card.label} ${card.style || ""} ${(card.tags || []).join(" ")}`.toLowerCase().includes(keyword) : true))
            .sort((a, b) => Number(b.liked) - Number(a.liked) || b.usage - a.usage || a.label.localeCompare(b.label));
    }, [cards, filter, query]);

    const toggleLike = (card: BrowserCard) => {
        const key = `image:${card.key}`;
        const next = new Set(liked);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setLiked(next);
        saveLikedPresets(config, card.modelValue, next).catch(() => setLiked(liked));
    };

    const useModel = (card: BrowserCard) => {
        if (!card.modelValue) return;
        bumpPresetUsage(card.key);
        onSelect(card.modelValue);
        setOpen(false);
    };

    return (
        <>
            <Tooltip title="本地模型浏览器">
                <Button
                    type="text"
                    className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                    style={{ color: theme.node.text }}
                    icon={<Grid2x2 className="size-3.5" />}
                    onClick={() => setOpen(true)}
                    aria-label="本地模型浏览器"
                />
            </Tooltip>
            <Modal title="本地模型浏览器" open={open} width={960} footer={null} centered destroyOnHidden mask={{ closable: true }} onCancel={() => setOpen(false)}>
                <div className="space-y-3">
                    <Input size="small" allowClear placeholder="搜索模型名、风格或标签" value={query} onChange={(event) => setQuery(event.target.value)} />
                    {loadError ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">{loadError}</div> : null}
                    {!presets && !loadError ? (
                        <div className="flex items-center gap-2 py-10 text-xs" style={{ color: theme.node.muted }}>
                            <Loader2 className="size-3.5 animate-spin" /> 正在读取本地模型档案…
                        </div>
                    ) : null}
                    {presets ? (
                        <div className="flex gap-3">
                            <aside
                                className="thin-scrollbar max-h-[540px] w-44 shrink-0 space-y-3 overflow-y-auto rounded-2xl border p-2"
                                style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
                            >
                                <div className="px-1.5 pt-1 text-[10px] font-medium tracking-[0.14em] uppercase" style={{ color: theme.node.faint }}>
                                    分组
                                </div>
                                <div className="space-y-1.5">
                                    {filterItems
                                        .filter((item) => item.kind !== "family")
                                        .map((item) => (
                                            <FilterChip
                                                key={item.key}
                                                item={item}
                                                active={filter === item.key}
                                                theme={theme}
                                                onClick={() => setFilter(item.key)}
                                            />
                                        ))}
                                </div>
                                <div className="mx-1 h-px" style={{ background: theme.node.stroke }} />
                                <div className="px-1.5 text-[10px] font-medium tracking-[0.14em] uppercase" style={{ color: theme.node.faint }}>
                                    模型族
                                </div>
                                <div className="space-y-1.5">
                                    {filterItems
                                        .filter((item) => item.kind === "family")
                                        .map((item) => (
                                            <FilterChip
                                                key={item.key}
                                                item={item}
                                                active={filter === item.key}
                                                theme={theme}
                                                onClick={() => setFilter(item.key)}
                                            />
                                        ))}
                                </div>
                            </aside>
                            <div className="thin-scrollbar grid max-h-[540px] min-w-0 flex-1 auto-rows-max grid-cols-2 content-start items-start gap-2 overflow-y-auto pr-1 md:grid-cols-3">
                                {visibleCards.map((card) => (
                                    <div
                                        key={card.key}
                                        className="group relative overflow-hidden rounded-xl border text-left transition-shadow hover:shadow-lg"
                                        style={{ borderColor: comfyPresetKey(model) === card.key ? theme.node.activeStroke : theme.node.stroke, background: theme.node.panel }}
                                    >
                                        <button type="button" className="block w-full cursor-pointer" onClick={() => useModel(card)}>
                                            <div className="relative grid h-28 w-full place-items-center overflow-hidden" style={{ background: theme.node.fill }}>
                                                {card.previewUrl ? (
                                                    <Popover
                                                        placement="right"
                                                        zIndex={1300}
                                                        mouseEnterDelay={0.25}
                                                        content={<img src={card.previewUrl} alt={card.label} className="max-h-[62vh] max-w-[420px] rounded-lg object-contain" />}
                                                    >
                                                        <img src={card.previewUrl} alt={card.label} loading="lazy" className="h-28 w-full object-contain" />
                                                    </Popover>
                                                ) : (
                                                    <div className="grid h-28 w-full place-items-center text-[11px]" style={{ color: theme.node.faint }}>
                                                        暂无预览
                                                    </div>
                                                )}
                                                <div
                                                    className="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium backdrop-blur"
                                                    style={{ background: "rgba(0,0,0,.45)", color: "#fff", border: `1px solid ${familyAccent(card.family || "其他")}66` }}
                                                >
                                                    {familyLabel(card.family || "其他")}
                                                </div>
                                            </div>
                                            <div className="space-y-1 p-2.5">
                                                <div className="truncate text-xs font-medium" style={{ color: theme.node.text }}>
                                                    {card.label}
                                                </div>
                                                {card.style ? (
                                                    <div className="line-clamp-2 text-[10px] leading-3.5" style={{ color: theme.node.muted }}>
                                                        {card.style}
                                                    </div>
                                                ) : null}
                                                <div className="flex items-center gap-2 text-[10px]" style={{ color: theme.node.faint }}>
                                                    {card.recommendedLoras?.length ? <span>推荐 {card.recommendedLoras.length} LoRA</span> : <span>推荐裸跑</span>}
                                                    {card.usage ? <span>用过 {card.usage} 次</span> : null}
                                                </div>
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            className="absolute right-1.5 top-1.5 grid size-7 cursor-pointer place-items-center rounded-full backdrop-blur"
                                            style={{ background: theme.toolbar.panel, color: card.liked ? "#f43f5e" : theme.node.muted }}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                toggleLike(card);
                                            }}
                                            aria-label={card.liked ? "取消收藏" : "收藏"}
                                        >
                                            <Heart className="size-3.5" fill={card.liked ? "currentColor" : "none"} />
                                        </button>
                                    </div>
                                ))}
                                {!visibleCards.length ? (
                                    <div className="col-span-full py-10 text-center text-xs" style={{ color: theme.node.muted }}>
                                        没有匹配的本地模型，试试换个筛选或关键词
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </div>
            </Modal>
        </>
    );
}

function FilterChip({
    item,
    active,
    theme,
    onClick,
}: {
    item: FilterItem;
    active: boolean;
    theme: CanvasTheme;
    onClick: () => void;
}) {
    const accent = item.kind === "family" ? familyAccent(item.key) : item.kind === "liked" ? "#f43f5e" : theme.node.activeStroke;
    const Icon = item.kind === "liked" ? Star : item.kind === "all" ? Sparkles : Layers3;
    return (
        <button
            type="button"
            className="group flex w-full cursor-pointer items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-all"
            style={{
                background: active ? `${accent}22` : "transparent",
                borderColor: active ? `${accent}88` : "transparent",
                color: theme.node.text,
                boxShadow: active ? `inset 0 0 0 1px ${accent}33` : "none",
            }}
            onClick={onClick}
        >
            <span
                className="grid size-6 shrink-0 place-items-center rounded-lg"
                style={{ background: active ? `${accent}33` : theme.node.fill, color: active ? accent : theme.node.muted }}
            >
                <Icon className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium leading-4">{item.label}</span>
                {item.kind === "family" ? (
                    <span className="block truncate text-[10px] leading-3" style={{ color: theme.node.faint }}>
                        {item.key}
                    </span>
                ) : null}
            </span>
            <span
                className="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums"
                style={{ background: active ? `${accent}33` : theme.node.fill, color: active ? accent : theme.node.muted }}
            >
                {item.count}
            </span>
        </button>
    );
}
