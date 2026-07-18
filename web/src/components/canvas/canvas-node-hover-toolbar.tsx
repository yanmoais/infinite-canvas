import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Dropdown, Modal, Segmented, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { Download, Ellipsis, FolderPlus, Image as ImageIcon, Info, MessageSquare, Minus, Music2, Pencil, Plus, RefreshCw, Settings2, Trash2, Upload, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasOperationKind, type ViewportTransform } from "@/types/canvas";
import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";
import { ImageToolSettingsModal, type ImageToolbarSettingsTool } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY, buildImageToolbarTools, defaultImageQuickToolIds, readImageQuickToolsConfig, splitImageToolbarTools, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onOutpaint: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReusePrompt: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    extraTools?: CanvasNodeToolbarItem[];
};

type ToolbarTool = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

export function CanvasNodeHoverToolbar({
    node,
    viewport,
    onKeep,
    onLeave,
    onInfo,
    onEditText,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onGenerateImage,
    onUpload,
    onDownload,
    onSaveAsset,
    onMaskEdit,
    onOutpaint,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onAngle,
    onViewImage,
    onReusePrompt,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onDelete,
    extraTools = [],
}: CanvasNodeHoverToolbarProps) {
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [showImageToolLabels, setShowImageToolLabels] = useState(false);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftShowImageToolLabels, setDraftShowImageToolLabels] = useState(false);
    const [overflowOpen, setOverflowOpen] = useState(false);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const { message } = App.useApp();
    const copyText = useCopyText();

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored) as unknown;
            const config = readImageQuickToolsConfig(parsed);
            setQuickImageToolIds(config.ids);
            setShowImageToolLabels(config.showLabels);
        } catch {
            window.localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        setImageToolSettingsOpen(false);
        setOverflowOpen(false);
    }, [node?.id]);

    if (!node) return null;

    const activeNode = node;
    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const top = viewport.y + node.position.y * viewport.k - 14;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isConfig = node.type === CanvasNodeType.Config;
    const canOpenDialog = isText || hasImage || isVideo;
    const canRetry = node.metadata?.status === "error" || (hasImage && Boolean(node.metadata?.prompt?.trim()));
    const quickImageToolIdSet = new Set(quickImageToolIds);
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning("暂无可复制的提示词");
            return;
        }
        copyText(prompt, "提示词已复制");
    };
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onMaskEdit, onOutpaint, onCrop, onSplit, onUpscale, onSuperResolve, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReusePrompt, onReversePrompt });

    function openImageToolSettings() {
        onKeep(activeNode.id);
        setDraftImageToolIds(quickImageToolIds);
        setDraftShowImageToolLabels(showImageToolLabels);
        setImageToolSettingsOpen(true);
    }

    const baseToolbarTools: ToolbarTool[] = [
        { id: "info", title: "查看节点信息", label: "信息", icon: <Info className="size-4" />, onClick: () => onInfo(node) },
        { id: "delete", title: "移除节点", label: "删除", icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
    ];
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canRetry ? [{ id: "retry", title: hasImage ? "用相同配置重新生成（生成为新节点，可对比）" : "重新生成", label: hasImage ? "再生成" : "重试", icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || isText ? [{ id: "saveAsset", title: "加入我的素材", label: "素材", icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: hasAudio ? "下载音频" : hasVideo ? "下载视频" : "下载图片", label: "下载", icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(canOpenDialog ? [{ id: "edit", title: "编辑", label: "编辑", icon: <MessageSquare className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "editText", title: "编辑文本", label: "编辑文字", icon: <Pencil className="size-4" />, onClick: () => onEditText(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: "用文本生图", label: "生图", icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isConfig ? [{ id: "config", title: "生成配置", label: "生成配置", icon: <Settings2 className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "decreaseFont", title: "减小字号", label: "缩小", icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText ? [{ id: "increaseFont", title: "增大字号", label: "放大", icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: "上传图片", label: "上传图片", icon: <Upload className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo ? [{ id: "uploadVideo", title: hasVideo ? "替换视频" : "上传视频", label: hasVideo ? "替换视频" : "上传视频", icon: <Video className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio ? [{ id: "uploadAudio", title: hasAudio ? "替换音频" : "上传音频", label: hasAudio ? "替换音频" : "上传音频", icon: <Music2 className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(hasImage ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, onClick: tool.onClick })) : []),
    ];
    const toolbarTools = hasImage
        ? [...baseToolbarTools, ...nodeToolbarTools, ...extraTools].filter((tool) => tool.id === "retry" || extraTools.some((extra) => extra.id === tool.id) || quickImageToolIdSet.has(tool.id as ImageQuickToolId))
        : [...baseToolbarTools, ...nodeToolbarTools, ...extraTools];
    const selectableImageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools].filter((tool) => tool.id !== "retry") as ImageToolbarSettingsTool[];

    const closeImageToolSettings = () => {
        setImageToolSettingsOpen(false);
        onLeave();
    };

    const setDraftImageToolVisible = (id: ImageQuickToolId, visible: boolean) => {
        setDraftImageToolIds((current) => {
            const selected = new Set(current);
            if (visible) selected.add(id);
            else selected.delete(id);
            return selectableImageToolbarTools.filter((tool) => selected.has(tool.id)).map((tool) => tool.id);
        });
    };

    const saveImageToolSettings = () => {
        const config = { ids: draftImageToolIds, showLabels: draftShowImageToolLabels };
        setQuickImageToolIds(config.ids);
        setShowImageToolLabels(config.showLabels);
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(config));
        closeImageToolSettings();
    };

    const { primary: primaryTools, overflow: overflowTools } = hasImage
        ? splitImageToolbarTools(toolbarTools, showImageToolLabels ? 6 : 9)
        : { primary: toolbarTools, overflow: [] as ToolbarTool[] };

    const overflowMenuItems: MenuProps["items"] = [
        ...overflowTools.map((tool) => ({
            key: tool.id,
            icon: <span className={`inline-flex size-4 items-center justify-center ${tool.danger ? "text-[#ef4444]" : ""}`}>{tool.icon}</span>,
            label: tool.label || tool.title,
            danger: tool.danger,
            onClick: () => {
                setOverflowOpen(false);
                tool.onClick();
            },
        })),
        ...(overflowTools.length
            ? [{ type: "divider" as const }]
            : []),
        {
            key: "customize",
            icon: <Settings2 className="size-4" />,
            label: "自定义工具栏",
            onClick: () => {
                setOverflowOpen(false);
                openImageToolSettings();
            },
        },
    ];

    return (
        <>
            <div
                className="absolute z-[70] -translate-x-1/2 -translate-y-full"
                style={{ left, top }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpen && !overflowOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="flex items-center gap-0.5 rounded-2xl border border-black/8 bg-white/95 px-1 py-0.5 text-[12px] text-[#1f2328] shadow-[0_10px_28px_rgba(15,23,42,.14)] backdrop-blur-md supports-[backdrop-filter]:bg-white/90">
                    {primaryTools.map((tool, index) => {
                        const prev = primaryTools[index - 1];
                        const groupOf = (id?: string) => {
                            if (!id) return 0;
                            if (id === "info" || id === "delete") return 1;
                            if (["retry", "saveAsset", "download", "edit"].includes(id)) return 2;
                            return 3;
                        };
                        const showDivider = index > 0 && groupOf(prev?.id) !== groupOf(tool.id);
                        return (
                            <div key={tool.id} className="flex items-center">
                                {showDivider ? <span className="mx-0.5 h-3.5 w-px bg-black/10" aria-hidden /> : null}
                                <ToolbarAction {...tool} showLabel={showImageToolLabels} compact />
                            </div>
                        );
                    })}
                    {hasImage ? (
                        <>
                            <span className="mx-0.5 h-4 w-px bg-black/8" aria-hidden />
                            <Dropdown
                                menu={{ items: overflowMenuItems }}
                                trigger={["click"]}
                                open={overflowOpen}
                                onOpenChange={setOverflowOpen}
                                placement="bottomRight"
                            >
                                <span>
                                    <ToolbarAction
                                        id="more"
                                        title={overflowTools.length ? `更多工具（${overflowTools.length}）` : "自定义工具栏"}
                                        label="更多"
                                        icon={<Ellipsis className="size-3.5" />}
                                        active={imageToolSettingsOpen || overflowOpen}
                                        onClick={() => {}}
                                        showLabel={showImageToolLabels}
                                        compact
                                    />
                                </span>
                            </Dropdown>
                        </>
                    ) : null}
                </div>
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    showLabels={draftShowImageToolLabels}
                    onToggle={setDraftImageToolVisible}
                    onShowLabelsChange={setDraftShowImageToolLabels}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
    const executionPlan = node?.metadata?.executionPlan;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>节点信息</span>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: "信息", value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
            {node ? (
                <div className="h-[56vh] min-h-[360px] text-sm">
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow label="名称" value={node.title || "未命名节点"} />
                            <InfoRow label="类型" value={node.type === CanvasNodeType.Text ? "文本" : node.type === CanvasNodeType.Image ? "图片" : node.type === CanvasNodeType.Video ? "视频" : node.type === CanvasNodeType.Audio ? "音频" : node.type === CanvasNodeType.Group ? "组" : "生成配置"} />
                            <InfoRow label="尺寸" value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                            <InfoRow label="位置" value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label="状态" value={node.metadata?.status || "idle"} />
                            {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
                            {node.metadata?.prompt ? <InfoRow label="提示词" value={node.metadata.prompt} /> : null}
                            {executionPlan ? <InfoRow label="执行模式" value={`${operationLabel(executionPlan.operation)}${executionPlan.managed ? " · 托管" : ""}`} /> : null}
                            {executionPlan?.values.model ? <InfoRow label="模型" value={formatPlanValue(executionPlan.values.model)} /> : null}
                            {executionPlan?.values.loras ? <InfoRow label="LoRA" value={formatPlanValue(executionPlan.values.loras)} /> : null}
                            {executionPlan?.values.referenceMode ? <InfoRow label="参考模式" value={formatPlanValue(executionPlan.values.referenceMode)} /> : null}
                            {executionPlan?.values.denoise ? <InfoRow label="denoise" value={formatPlanValue(executionPlan.values.denoise)} /> : null}
                            {executionPlan?.values.faceDetailer ? <InfoRow label="精修" value={formatPlanValue(executionPlan.values.faceDetailer)} /> : null}
                            {executionPlan?.protections?.length ? <InfoRow label="保护策略" value={executionPlan.protections.join("\n")} /> : null}
                            {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function ToolbarAction({ title, label, icon, onClick, showLabel, active = false, danger = false, compact = false }: ToolbarTool & { showLabel: boolean; compact?: boolean }) {
    const hasText = showLabel && Boolean(label);
    const buttonHeight = compact ? "h-8" : "h-12";
    const chipHeight = compact ? "h-7" : "h-9";
    const chipPad = hasText ? (compact ? "gap-1 px-2" : "gap-2 px-2.5") : compact ? "justify-center px-1.5" : "justify-center px-2";
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.15} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 12, fontWeight: 500 } }}>
            <button type="button" className={`group relative flex ${buttonHeight} items-center whitespace-nowrap ${compact ? "px-0.5" : "px-1.5"} ${danger ? "text-[#ef4444]" : "text-[#2a2f36]"}`} onClick={onClick} aria-label={title}>
                <span className={`flex ${chipHeight} items-center ${chipPad} rounded-lg transition group-hover:bg-[#eef0f3] ${active ? "bg-[#e8eaee]" : ""}`}>
                    <span className="grid place-items-center [&>svg]:size-3.5">{icon}</span>
                    {hasText ? <span className="text-[11px] font-medium leading-none tracking-tight">{label}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}

function operationLabel(operation: CanvasOperationKind) {
    if (operation === "outpaint") return "画面扩图";
    if (operation === "inpaint") return "局部编辑";
    if (operation === "character_atelier") return "角色部件工坊";
    if (operation === "exact_replay") return "精确重试";
    return "普通生成";
}

function formatPlanValue(item: { value: string | number | boolean | string[] | null; source: string }) {
    const value = Array.isArray(item.value) ? (item.value.length ? item.value.join(", ") : "明确无 LoRA") : item.value === null ? "关闭" : typeof item.value === "boolean" ? (item.value ? "开启" : "关闭") : String(item.value);
    const sources: Record<string, string> = {
        manual_node: "节点设置",
        source_recipe: "源图配方",
        operation_profile: "操作档案",
        preset_default: "预设默认",
        exact_replay: "精确重试",
    };
    return `${value} · ${sources[item.source] || item.source}`;
}
