import { useEffect, useId, useMemo, useState } from "react";
import { Cpu } from "lucide-react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type UiModelCapability } from "@/stores/use-config-store";
import { bumpPresetUsage, comfyPresetKey, fetchComfyPresets, isComfyModel, presetUsageCount } from "@/services/api/comfy";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: UiModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

type ModelGroup = {
    key: string;
    label: string;
    models: string[];
    totalUsage: number;
};

const FAMILY_LABELS: Record<string, string> = {
    sdxl: "SDXL",
    sd15: "SD1.5",
    anima: "Anima",
    zimage: "Z-Image",
    qwen_image: "Qwen Image",
    qwen_image_edit: "Qwen Edit",
    post_process: "后处理",
    vision_caption: "视觉理解",
    other: "其他本地模型",
    remote: "云端 / 其他模型",
};

function prettyFamily(family: string) {
    return FAMILY_LABELS[family.toLowerCase()] || family;
}

/** Compact list label: drop redundant channel suffix for local comfy models. */
function modelPickerListLabel(config: AiConfig, model: string) {
    const name = modelOptionName(model);
    if (isComfyModel(model)) {
        return name.replace(/^comfy\//i, "");
    }
    return modelOptionLabel(config, model);
}

function modelPickerTriggerLabel(config: AiConfig, model: string) {
    if (isComfyModel(model)) return modelPickerListLabel(config, model);
    return modelOptionLabel(config, model);
}

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder = "选择模型", onMissingConfig }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [familyByPreset, setFamilyByPreset] = useState<Record<string, string>>({});
    const [usageTick, setUsageTick] = useState(0);
    const options = useMemo(
        () => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))),
        [capability, config, value],
    );
    const current = value || "";
    const hasComfyOptions = useMemo(() => options.some((model) => isComfyModel(model)), [options]);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    useEffect(() => {
        if (!open || !hasComfyOptions || capability !== "image") return;
        const referenceModel = current || options.find((model) => isComfyModel(model)) || "";
        if (!referenceModel) return;
        let cancelled = false;
        fetchComfyPresets(config, referenceModel)
            .then((presets) => {
                if (cancelled) return;
                const next: Record<string, string> = {};
                for (const [key, preset] of Object.entries(presets.imagePresets)) {
                    next[key] = (preset.family || "other").toLowerCase();
                }
                setFamilyByPreset(next);
            })
            .catch(() => {
                if (!cancelled) setFamilyByPreset({});
            });
        return () => {
            cancelled = true;
        };
    }, [capability, config, current, hasComfyOptions, open, options]);

    const groups = useMemo<ModelGroup[]>(() => {
        void usageTick;
        if (!options.length) return [];

        if (capability !== "image" || !hasComfyOptions) {
            const sorted = [...options].sort((a, b) => {
                const usageDiff = modelUsage(b) - modelUsage(a);
                if (usageDiff) return usageDiff;
                return modelPickerListLabel(config, a).localeCompare(modelPickerListLabel(config, b));
            });
            return [{ key: "all", label: "模型", models: sorted, totalUsage: sorted.reduce((sum, model) => sum + modelUsage(model), 0) }];
        }

        const bucket = new Map<string, string[]>();
        for (const model of options) {
            const groupKey = isComfyModel(model) ? familyByPreset[comfyPresetKey(model)] || "other" : "remote";
            const list = bucket.get(groupKey) || [];
            list.push(model);
            bucket.set(groupKey, list);
        }

        const ordered = Array.from(bucket.entries()).map(([key, models]) => {
            const sortedModels = [...models].sort((a, b) => {
                const usageDiff = modelUsage(b) - modelUsage(a);
                if (usageDiff) return usageDiff;
                return modelPickerListLabel(config, a).localeCompare(modelPickerListLabel(config, b));
            });
            return {
                key,
                label: key === "remote" ? prettyFamily("remote") : `本地生图 · ${prettyFamily(key)}`,
                models: sortedModels,
                totalUsage: sortedModels.reduce((sum, model) => sum + modelUsage(model), 0),
            };
        });

        ordered.sort((a, b) => {
            if (a.key === "remote" && b.key !== "remote") return 1;
            if (b.key === "remote" && a.key !== "remote") return -1;
            const usageDiff = b.totalUsage - a.totalUsage;
            if (usageDiff) return usageDiff;
            return a.label.localeCompare(b.label);
        });
        return ordered;
    }, [capability, config, familyByPreset, hasComfyOptions, options, usageTick]);

    const handleChange = (model: string) => {
        if (isComfyModel(model)) {
            bumpPresetUsage(comfyPresetKey(model));
            setUsageTick((value) => value + 1);
        }
        onChange(model);
    };

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={handleChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : placeholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelPickerTriggerLabel(config, current) : placeholder}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] w-[22rem] max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1.5 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {groups.length ? (
                    groups.map((group, index) => (
                        <div key={group.key}>
                            {index > 0 ? <SelectSeparator className="my-1.5" /> : null}
                            <SelectGroup className="p-0">
                                <SelectLabel className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                                    <span className="min-w-0 truncate">{group.label}</span>
                                    <span className="shrink-0 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{group.models.length}</span>
                                </SelectLabel>
                                {group.models.map((model) => {
                                    const usage = modelUsage(model);
                                    const listLabel = modelPickerListLabel(config, model);
                                    const fullLabel = modelOptionLabel(config, model);
                                    return (
                                        <SelectItem
                                            key={model}
                                            value={model}
                                            textValue={fullLabel}
                                            title={fullLabel}
                                            className="w-full py-2 pr-10 pl-2 [&>span:last-child]:block [&>span:last-child]:w-full [&>span:last-child]:min-w-0"
                                        >
                                            {/*
                                              Fixed three-zone row for dense product UI:
                                              [icon][name truncates] ........ [usage badge] [absolute check]
                                              Right padding reserves the check; usage has its own non-shrinking column.
                                            */}
                                            <span className="flex w-full min-w-0 items-center gap-2">
                                                <ModelIcon model={model} />
                                                <span className="min-w-0 flex-1 truncate text-left font-medium tracking-tight">{listLabel}</span>
                                                {usage > 0 ? (
                                                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums leading-none text-muted-foreground">
                                                        {usage}次
                                                    </span>
                                                ) : (
                                                    <span className="w-0 shrink-0" aria-hidden />
                                                )}
                                            </span>
                                        </SelectItem>
                                    );
                                })}
                            </SelectGroup>
                        </div>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function modelUsage(model: string) {
    return isComfyModel(model) ? presetUsageCount(comfyPresetKey(model)) : 0;
}

function emptyModelLabel(config: AiConfig, capability?: UiModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `请先在渠道里为${label}指定模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "请先到配置里添加渠道和模型";
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
