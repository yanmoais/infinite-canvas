import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImageIcon, LoaderCircle, MessageSquare, Square } from "lucide-react";
import { Button } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, modelMatchesCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasComfySettingsPopover } from "./canvas-comfy-settings-popover";
import { CanvasModelBrowser } from "./canvas-model-browser";
import { defaultLorasForModel, isComfyModel } from "@/services/api/comfy";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, source?: "direct" | "composer") => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // 插件节点用 useBuiltinPanel.mode 指定生成类型
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onImageSettingsOpenChange, modeOverride }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const promptDraft = node.metadata?.promptDraft || "";
    const [prompt, setPrompt] = useState(promptDraft || (isEditingExistingContent ? "" : node.metadata?.prompt || ""));

    useEffect(() => {
        setPrompt(isEditingExistingContent ? "" : node.metadata?.prompt || "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditingExistingContent, node.id]);

    useEffect(() => {
        if (!promptDraft) return;
        setPrompt(promptDraft);
        onConfigChange(node.id, { promptDraft: undefined });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id, promptDraft]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
    };
    const pendingModelRef = useRef("");
    const updateImageModel = (model: string) => {
        onConfigChange(node.id, { model });
        pendingModelRef.current = model;
        if (!isComfyModel(model)) return;
        defaultLorasForModel(config, model)
            .then((comfyLoras) => {
                if (comfyLoras !== undefined && pendingModelRef.current === model) onConfigChange(node.id, { comfyLoras });
            })
            .catch(() => undefined);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return;
        onGenerate(node.id, mode, text, "direct");
        setPrompt("");
    };

    return (
        <div
            className="w-[760px] max-w-[calc(100vw-32px)] rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <CanvasPromptLibrary
                        config={config}
                        value={prompt}
                        identitySeed={
                            hasImageContent
                                ? node.metadata?.originalIdentityPrompt || node.metadata?.originalPrompt || node.metadata?.prompt || ""
                                : ""
                        }
                        hasReferenceImages={Boolean(hasImageContent)}
                        onIdentitySeedCommit={
                            hasImageContent
                                ? (identityPrompt) => {
                                      onConfigChange(node.id, {
                                          originalIdentityPrompt: identityPrompt,
                                          originalPrompt: node.metadata?.originalPrompt || identityPrompt,
                                      } as Partial<CanvasNodeData["metadata"]>);
                                  }
                                : undefined
                        }
                        onPipelineOptionsChange={(options) => {
                            const prev = (node.metadata as { poseRefineOptions?: typeof options } | undefined)?.poseRefineOptions;
                            if (
                                prev &&
                                prev.face_refine === options.face_refine &&
                                prev.skirt_refine === options.skirt_refine &&
                                prev.part_refine === options.part_refine &&
                                prev.hair_refine === options.hair_refine
                            ) {
                                return;
                            }
                            onConfigChange(node.id, {
                                poseRefineOptions: options,
                            } as Partial<CanvasNodeData["metadata"]>);
                        }}
                        onSelect={updatePrompt}
                        onGenerate={(text) => {
                            if (isRunning || !text.trim()) return;
                            // 图片节点上的组合器：生成时带上本节点身份种子（后端/父级还会再 merge 一次）
                            const seed = hasImageContent
                                ? node.metadata?.originalIdentityPrompt || node.metadata?.originalPrompt || node.metadata?.prompt || ""
                                : "";
                            const payload = seed ? `${text.trim()}` : text.trim();
                            onGenerate(node.id, mode, payload, "composer");
                            setPrompt("");
                        }}
                    />
                    {mode === "image" ? (
                        <>
                            <div className="flex min-w-[15rem] max-w-[18rem] flex-1 items-center gap-1.5 rounded-full border px-2 py-1" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                                <MessageSquare className="size-3.5 shrink-0 opacity-70" />
                                <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                                    提示词
                                </span>
                                <ModelPicker className="!h-8 !min-w-0 !flex-1 !border-0 !bg-transparent !px-1" config={config} value={config.textModel} onChange={(promptModel) => onConfigChange(node.id, { promptModel })} capability="text" onMissingConfig={() => openConfigDialog(true)} fullWidth />
                            </div>
                            <div className="flex min-w-[15rem] max-w-[18rem] flex-1 items-center gap-1.5 rounded-full border px-2 py-1" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                                <ImageIcon className="size-3.5 shrink-0 opacity-70" />
                                <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                                    生图
                                </span>
                                <ModelPicker className="!h-8 !min-w-0 !flex-1 !border-0 !bg-transparent !px-1" config={config} value={config.model} onChange={updateImageModel} capability="image" onMissingConfig={() => openConfigDialog(true)} fullWidth />
                                <CanvasModelBrowser config={config} model={config.model} onSelect={updateImageModel} />
                            </div>
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                            {isComfyModel(config.model) ? (
                                <CanvasComfySettingsPopover
                                    config={config}
                                    model={config.model}
                                    buttonClassName="!h-10 !max-w-[190px] !justify-start !rounded-full !px-3"
                                    settings={{
                                        comfyReferenceMode: node.metadata?.comfyReferenceMode,
                                        comfyLoras: node.metadata?.comfyLoras,
                                        comfyFaceDetailer: node.metadata?.comfyFaceDetailer,
                                        comfyDenoise: node.metadata?.comfyDenoise,
                                    }}
                                    onSettingsChange={(patch) => onConfigChange(node.id, patch)}
                                />
                            ) : null}
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                    )}
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={!isRunning && !prompt.trim()}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={isRunning ? "停止生成" : "生成"}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">停止</span>
                            </>
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </span>
                </Button>
            </div>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const fallbackModel = mode === "image" ? defaultConfig.imageModel : mode === "video" ? defaultConfig.videoModel : mode === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const currentModel = node.metadata?.model;
    const model = currentModel && modelMatchesCapability(globalConfig, currentModel, mode)
        ? currentModel
        : defaultModel && modelMatchesCapability(globalConfig, defaultModel, mode)
            ? defaultModel
            : fallbackModel;
    return {
        ...globalConfig,
        model,
        textModel: node.metadata?.promptModel || globalConfig.textModel || defaultConfig.textModel,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
