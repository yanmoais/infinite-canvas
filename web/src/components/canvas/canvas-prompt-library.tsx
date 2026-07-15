import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Modal, Tooltip } from "antd";
import { BookOpen, Flame, Loader2, Sparkles, WandSparkles, X } from "lucide-react";

import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import {
    analyzeComposeCompleteness,
    buildSelectionFromSceneTemplate,
    composePromptFromBaseAndTags,
    isTrueReferencePoseChange,
    extractIdentityPack,
    extractSceneTemplates,
    getPoseChangePipelineStatus,
    getTagRelationHint,
    isQualityPrefixTag,
    isQualitySuffixTag,
    mergeIdentityPackIntoSelection,
    type SceneTemplateInfo,
    type TagRelationHint,
} from "@/lib/canvas/smart-compose-prompt";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { bumpTagUsage, fetchPromptLibrary, tagUsageMap, type PromptLibraryCategory, type PromptLibraryGroup, type PromptLibraryTag } from "@/services/api/prompt-library";

type CanvasPromptLibraryProps = {
    config?: AiConfig;
    value?: string;
    /** 图片节点原 prompt / 身份源：只展示，不直接当编辑 value，避免站姿词污染组合器 */
    identitySeed?: string;
    /** 当前是否带着参考图（图片节点），用于 pose-change 链路状态 */
    hasReferenceImages?: boolean;
    onSelect: (prompt: string) => void;
    onGenerate?: (prompt: string) => void;
    /** 把具体外观词写回图片节点 originalIdentityPrompt（有图≠自动有发色瞳色文字） */
    onIdentitySeedCommit?: (identityPrompt: string) => void;
    /** 生成前把 refine 开关并入 comfyExtra 的可选回调 */
    onPipelineOptionsChange?: (options: {
        face_refine: boolean;
        skirt_refine: boolean;
        part_refine: boolean;
        hair_refine: boolean;
    }) => void;
};

type SectionedGroup = {
    key: string;
    title: string;
    subtitle?: string;
    zone: "prefix" | "core" | "suffix" | "other";
    tags: PromptLibraryTag[];
};

/**
 * Design read: product tool combinator for dense prompt authoring.
 * Tone = refined utilitarian dark cockpit; density = high; motion = minimal.
 * Goal: selected / blocked / boost / warn states are glanceable without fighting the canvas theme.
 */
/* typography-v9 image-node identity chips */
export function CanvasPromptLibrary({ config, value = "", identitySeed = "", hasReferenceImages = false, onSelect, onGenerate, onIdentitySeedCommit, onPipelineOptionsChange }: CanvasPromptLibraryProps) {
    const { message } = App.useApp();
    const identitySeedPreview = identitySeed.trim();
    const [open, setOpen] = useState(false);
    const [selectOpen, setSelectOpen] = useState(false);
    const [categories, setCategories] = useState<PromptLibraryCategory[]>([]);
    const [activeCategory, setActiveCategory] = useState("");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<Record<string, PromptLibraryTag>>({});
    const [loadError, setLoadError] = useState("");
    const [loading, setLoading] = useState(false);
    const [usage, setUsage] = useState<Record<string, number>>({});
    const [smartCompose, setSmartCompose] = useState(true);
    const [faceRefine, setFaceRefine] = useState(true);
    const [skirtRefine, setSkirtRefine] = useState(true);
    const [hairRefine, setHairRefine] = useState(false);
    const [partRefine, setPartRefine] = useState(true);
    const [refineHydrated, setRefineHydrated] = useState(false);
    /** 组合器内手写/粘贴具体发色瞳色服装 */
    const [identityDraft, setIdentityDraft] = useState("");
    /** 固定区只留摘要；链路/ densify 长文折叠 */
    const [headerDetailOpen, setHeaderDetailOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const seededSelectionForOpenRef = useRef(false);
    useEffect(() => {
        if (!open) {
            seededSelectionForOpenRef.current = false;
            return;
        }
        if (!config) return;
        setLoadError("");
        setLoading(true);
        setUsage(tagUsageMap());
        fetchPromptLibrary(config, config.model || config.imageModel || config.textModel)
            .then((items) => {
                setCategories(items);
                setActiveCategory((current) => current || items[0]?.id || "");
                // 只在本次打开时从 prompt 同步一次；避免中途重拉/重挂载把已选手动选择冲掉
                if (!seededSelectionForOpenRef.current) {
                    setSelected(matchSelectedFromPrompt(items, value));
                    seededSelectionForOpenRef.current = true;
                }
            })
            .catch((error) => setLoadError(error instanceof Error ? error.message : "读取提示词库失败"))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config, open]);

    const active = categories.find((category) => category.id === activeCategory) || categories[0];
    const filteredGroups = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return (active?.groups || [])
            .map((group) => ({
                ...group,
                tags: keyword ? group.tags.filter((tag) => `${tag.en} ${tag.zh || ""}`.toLowerCase().includes(keyword)) : group.tags,
            }))
            .filter((group) => group.tags.length);
    }, [active, query]);

    const sectionedGroups = useMemo(() => sectionGroupsForDisplay(active?.id || "", filteredGroups), [active?.id, filteredGroups]);

    const hotTags = useMemo(() => {
        const all = new Map<string, PromptLibraryTag>();
        for (const category of categories) for (const group of category.groups) for (const tag of group.tags) if (!all.has(tag.en)) all.set(tag.en, tag);
        return [...all.values()]
            .map((tag) => ({ tag, count: usage[tag.en.toLowerCase()] || 0 }))
            .filter((item) => item.count > 0)
            .sort((a, b) => b.count - a.count || a.tag.en.localeCompare(b.tag.en))
            .slice(0, 24);
    }, [categories, usage]);

    const sceneTemplates = useMemo(() => extractSceneTemplates(categories), [categories]);

    const libraryTagIndex = useMemo(() => {
        const map = new Map<string, PromptLibraryTag>();
        for (const category of categories) {
            for (const group of category.groups) {
                for (const tag of group.tags) {
                    if (!map.has(tag.en.toLowerCase())) map.set(tag.en.toLowerCase(), tag);
                }
            }
        }
        return map;
    }, [categories]);

    const selectedTags = useMemo(
        () => Object.values(selected).sort((a, b) => (a.orderWeight ?? 50) - (b.orderWeight ?? 50) || a.en.localeCompare(b.en)),
        [selected],
    );
    const selectedTagTexts = useMemo(() => selectedTags.map((tag) => tag.en), [selectedTags]);

    const identityPack = useMemo(() => {
        // 文生图抽卡：没有参考身份源时，用「当前输入 + 已选外观标签」当草稿身份
        const selectedAppearance = selectedTagTexts
            .filter((tag) =>
                /\b(same face|same hair|same outfit|hair|eyes|dress|skirt|hem|frill|bow|bangs|twintails|ponytail|skin|cute beautiful girl|detailed face|natural skin|no yellow)\b/i.test(
                    tag,
                ),
            )
            .join(", ");
        const draft = [identitySeed, value, selectedAppearance].filter((part) => part && part.trim()).join(", ");
        return extractIdentityPack(draft, {
            hasReferenceImages,
            // 纯文生图也给 same face/hair/outfit 可选锁，方便后续以该图为参考
            includeLocks: true,
            // 只有当前草稿本身是真换姿时才注入 change pose；避免「有参考图」就误伤站姿换装
            includePoseChange: hasReferenceImages && isTrueReferencePoseChange(draft, true),
            currentPrompt: value,
        });
    }, [identitySeed, value, hasReferenceImages, selectedTagTexts]);

    const selectedPrefix = useMemo(() => selectedTags.filter((tag) => isQualityPrefixTag(tag)), [selectedTags]);
    const selectedSuffix = useMemo(() => selectedTags.filter((tag) => isQualitySuffixTag(tag) && !isQualityPrefixTag(tag)), [selectedTags]);
    const selectedCore = useMemo(
        () => selectedTags.filter((tag) => !isQualityPrefixTag(tag) && !isQualitySuffixTag(tag)),
        [selectedTags],
    );

    const composed = useMemo(
        () => composePromptFromBaseAndTags(value, selectedTagTexts, smartCompose, { hasReferenceImages }),
        [selectedTagTexts, smartCompose, value, hasReferenceImages],
    );

    const completeness = useMemo(
        () =>
            analyzeComposeCompleteness(composed.prompt || value, {
                hasReferenceImages,
                identitySeed,
            }),
        [composed.prompt, value, hasReferenceImages, identitySeed],
    );

    const pipelineStatus = useMemo(
        () =>
            getPoseChangePipelineStatus(composed.prompt || value, {
                hasReferenceImages,
                identitySeed,
            }),
        [composed.prompt, value, hasReferenceImages, identitySeed],
    );


    useEffect(() => {
        try {
            const raw = localStorage.getItem("nannan.canvas.poseRefineOptions.v1");
            if (raw) {
                const parsed = JSON.parse(raw) as {
                    face_refine?: boolean;
                    skirt_refine?: boolean;
                    part_refine?: boolean;
                    hair_refine?: boolean;
                };
                if (typeof parsed.face_refine === "boolean") setFaceRefine(parsed.face_refine);
                if (typeof parsed.skirt_refine === "boolean") setSkirtRefine(parsed.skirt_refine);
                if (typeof parsed.part_refine === "boolean") setPartRefine(parsed.part_refine);
                if (typeof parsed.hair_refine === "boolean") setHairRefine(parsed.hair_refine);
            }
        } catch {
            /* ignore */
        }
        setRefineHydrated(true);
    }, []);

    const lastEmittedRefineRef = useRef("");
    useEffect(() => {
        if (!refineHydrated) return;
        const options = {
            face_refine: faceRefine,
            skirt_refine: skirtRefine,
            part_refine: partRefine,
            hair_refine: hairRefine,
        };
        const serialized = JSON.stringify(options);
        // 开关值未变则不落盘/不上抛，避免父组件 setState 导致 Modal 抽搐
        if (serialized === lastEmittedRefineRef.current) return;
        lastEmittedRefineRef.current = serialized;
        try {
            localStorage.setItem("nannan.canvas.poseRefineOptions.v1", serialized);
        } catch {
            /* ignore */
        }
        // 仅弹窗打开时通知父级；关闭时本地已记住即可
        if (open) onPipelineOptionsChange?.(options);
    }, [faceRefine, skirtRefine, partRefine, hairRefine, onPipelineOptionsChange, refineHydrated, open]);


    const relationHints = useMemo(() => {
        if (!smartCompose) return {} as Record<string, TagRelationHint>;
        const hints: Record<string, TagRelationHint> = {};
        const visible: PromptLibraryTag[] = [];
        for (const group of sectionedGroups) visible.push(...group.tags);
        for (const { tag } of hotTags) visible.push(tag);
        const seen = new Set<string>();
        for (const tag of visible) {
            if (selected[tag.en] || seen.has(tag.en)) continue;
            seen.add(tag.en);
            const hint = getTagRelationHint(tag.en, selectedTagTexts, value);
            if (hint) hints[tag.en] = hint;
        }
        return hints;
    }, [hotTags, sectionedGroups, selected, selectedTagTexts, smartCompose, value]);

    const toggleTag = (tag: PromptLibraryTag, event?: { button?: number; type?: string }) => {
        // 禁止右键/中键改选：只允许左键点击；清空只能走「清空已选」或已选标签上的 X
        if (event && typeof event.button === "number" && event.button !== 0) return;
        if (smartCompose) {
            const hint = relationHints[tag.en];
            if (hint?.severity === "block" && !selected[tag.en]) return;
        }
        setSelected((current) => {
            const next = { ...current };
            if (next[tag.en]) delete next[tag.en];
            else next[tag.en] = tag;
            return next;
        });
    };

    const clearAllSelected = () => {
        setSelected({});
    };

    const applySceneTemplate = (template: SceneTemplateInfo) => {
        const built = buildSelectionFromSceneTemplate(template, Object.values(selected), {
            hasReferenceImages,
            identitySeed: identitySeed || value,
        });
        const next: Record<string, PromptLibraryTag> = {};
        for (const item of built) {
            const hit = libraryTagIndex.get(item.en.toLowerCase());
            next[item.en] = hit || { en: item.en, zh: item.zh || item.en, orderWeight: item.orderWeight, kind: item.kind };
        }
        setSelected(next);
        // 一键模板后切到 R18/体位类目（若存在）方便继续微调
        const poseCat = categories.find((category) => /r18|体位|姿势|动作/i.test(`${category.id} ${category.label}`));
        if (poseCat) setActiveCategory(poseCat.id);
    };

    const applyIdentityPack = () => {
        // 与 memo 一致：优先参考身份源，否则用当前草稿外观
        const pack = identityPack;
        if (!pack.tags.length) {
            message.warning("身份包是空的：参考图没有可用外观词，请手写发色/瞳色/服装");
            return;
        }
        const before = new Set(Object.keys(selected).map((k) => k.toLowerCase()));
        const built = mergeIdentityPackIntoSelection(Object.values(selected), pack);
        const next: Record<string, PromptLibraryTag> = {};
        let added = 0;
        for (const item of built) {
            const hit = libraryTagIndex.get(item.en.toLowerCase());
            next[item.en] = hit || { en: item.en, zh: item.zh || item.en, orderWeight: item.orderWeight, kind: item.kind };
            if (!before.has(item.en.toLowerCase())) added += 1;
        }
        setSelected(next);
        if (added > 0) {
            message.success(`已并入身份包：新增 ${added} 个标签`);
        } else {
            message.info(pack.weak
                ? "身份包标签已在已选里。但缺少具体发色/瞳色——请手写或从带原 prompt 的图打开"
                : "身份包标签已在已选里，无需重复添加");
        }
    };

    const applySuggestedTags = (tags: string[] | undefined, options?: { toggle?: boolean; label?: string }) => {
        if (!tags?.length) {
            message.warning(options?.label
                ? `${options.label}：身份源没有可自动补的具体词，请手写`
                : "没有可自动补的标签");
            return;
        }
        const current = selected;
        const next: Record<string, PromptLibraryTag> = { ...current };
        let added = 0;
        let removed = 0;
        for (const en of tags) {
            const key = Object.keys(next).find((k) => k.toLowerCase() === en.toLowerCase());
            if (key) {
                if (options?.toggle) {
                    delete next[key];
                    removed += 1;
                }
                continue;
            }
            const hit = libraryTagIndex.get(en.toLowerCase());
            next[en] = hit || { en, zh: en };
            added += 1;
        }
        setSelected(next);
        if (added > 0) {
            message.success(options?.label ? `${options.label}：已加入 ${added} 个` : `已加入 ${added} 个标签`);
        } else if (removed > 0) {
            message.info(`已取消 ${removed} 个标签`);
        } else {
            message.info(options?.label
                ? `${options.label}：这些词已在已选里（若仍提示必须补，说明需要更具体的发色/瞳色，不能只靠 same hair）`
                : "这些标签已在已选里");
        }
    };

    const toggleEvidenceTerm = (term: string) => {
        applySuggestedTags([term], { toggle: true, label: "身份证据" });
    };

    /** 从已选/组合结果里抽出外观词，写回本图节点身份源 */
    const commitIdentitySeedFromSelection = () => {
        if (!onIdentitySeedCommit) {
            message.warning("当前节点不支持写回身份源");
            return;
        }
        const corpus = [composed.prompt, value, ...selectedTagTexts].filter(Boolean).join(", ");
        const pack = extractIdentityPack(corpus, {
            hasReferenceImages: true,
            includeLocks: false,
            includePoseChange: false,
            currentPrompt: corpus,
        });
        // 只要具体外观证据；不要把 same face / change pose 当身份源写回去
        const concrete = pack.evidence.filter((term) =>
            /\b(hair|eyes|dress|skirt|uniform|outfit|bangs|twintails|ponytail|hem|frill|bow|skin tone|yellow tint|beautiful girl)\b/i.test(term)
            && !/\b(same face|same hair|same outfit|change pose|match reference)\b/i.test(term),
        );
        // 再补一轮 regex 直接抽
        const extras: string[] = [];
        const patterns = [
            /\blong brown hair with teal tips\b/i,
            /\bbrown hair with teal tips\b/i,
            /\blong hair with teal tips\b/i,
            /\bteal tips\b/i,
            /\b(?:brown|black|blonde|silver|white|pink|red|blue|purple|green) hair\b/i,
            /\b(?:blue|brown|green|red|amber|purple|golden|black|grey|gray) eyes\b/i,
            /\b(?:white|black|red|blue|pink|cream white)(?: long-sleeve| summer)? dress\b/i,
            /\b(?:school uniform|sailor uniform|maid outfit)\b/i,
            /\b(?:flared skirt|ruffled skirt hem|frilled hem|collar bow)\b/i,
            /\bcute beautiful girl\b/i,
            /\bdetailed face\b/i,
            /\bnatural skin tone\b/i,
        ];
        const seen = new Set(concrete.map((t) => t.toLowerCase()));
        for (const re of patterns) {
            const m = corpus.match(re);
            if (m && !seen.has(m[0].toLowerCase())) {
                extras.push(m[0]);
                seen.add(m[0].toLowerCase());
            }
        }
        const finalTerms = [...concrete, ...extras];
        const hasHair = finalTerms.some((t) => /(hair|teal tips)/i.test(t) && /(brown|black|blonde|silver|white|pink|blue|red|purple|green|teal)/i.test(t));
        const hasEyes = finalTerms.some((t) => /\b(blue|brown|green|red|amber|purple|golden|black|grey|gray) eyes\b/i.test(t));
        if (!finalTerms.length || (!hasHair && !hasEyes)) {
            message.warning("已选里还没有具体发色/瞳色。请先在词库点选或手写，例如 long brown hair with teal tips, blue eyes, white dress");
            return;
        }
        const identityPrompt = finalTerms.join(", ");
        onIdentitySeedCommit(identityPrompt);
        // 同步并入已选，立刻消红字
        applySuggestedTags(finalTerms, { label: "写回身份源" });
        message.success("已写回本图身份源（下次打开组合器会直接用）");
    };

    const applyIdentityDraftText = (text: string, alsoCommit: boolean) => {
        const raw = String(text || "").trim();
        if (!raw) {
            message.warning("请先在上方输入框粘贴或手写：如 long brown hair with teal tips, blue eyes, white dress");
            return;
        }
        const parts = raw
            .split(/[,，\n;；]+/)
            .map((part) => part.trim())
            .filter(Boolean);
        if (!parts.length) {
            message.warning("没解析出可用标签，请用逗号分隔");
            return;
        }
        applySuggestedTags(parts, { label: "粘贴身份词" });
        if (alsoCommit) {
            if (!onIdentitySeedCommit) {
                message.warning("当前节点不支持写回身份源；词已加入已选");
                return;
            }
            // 直接用粘贴原文写回，避免只抽到 partial
            onIdentitySeedCommit(parts.join(", "));
            message.success("已并入已选，并写回本图身份源");
        }
    };

    const buildNextPrompt = () => composed.prompt;
    const appendSelected = () => {
        if (!selectedTags.length && !value.trim()) return;
        if (selectedTags.length) bumpTagUsage(selectedTags.map((tag) => tag.en));
        const nextPrompt = buildNextPrompt();
        if (!nextPrompt.trim()) return;
        onSelect(nextPrompt);
        setOpen(false);
    };
    const generateNow = () => {
        if (!onGenerate) return;
        const nextPrompt = buildNextPrompt();
        if (!nextPrompt.trim()) return;
        if (selectedTags.length) bumpTagUsage(selectedTags.map((tag) => tag.en));
        onSelect(nextPrompt);
        onGenerate(nextPrompt);
        setOpen(false);
    };

    return (
        <>
            <Tooltip title="提示词库 / 标签组合器">
                <Button
                    type="text"
                    className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                    style={{ color: theme.node.text }}
                    icon={<BookOpen className="size-3.5" />}
                    onClick={() => (config ? setOpen(true) : setSelectOpen(true))}
                    aria-label="提示词库"
                />
            </Tooltip>
            <PromptSelectDialog open={selectOpen} onOpenChange={setSelectOpen} onSelect={onSelect} />
            <Modal
                title={<span style={{ fontSize: 15, fontWeight: 600 }}>提示词组合器 <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.55, fontWeight: 400 }}>v16.1·自动去重同义·请硬刷新</span></span>}
                open={open}
                width={1320}
                footer={null}
                // 禁用 centered：词库加载/父级回写会反复重算垂直位置，表现为弹窗抽搐
                centered={false}
                style={{ top: 20, paddingBottom: 0 }}
                destroyOnHidden
                mask={{ closable: false }}
                onCancel={() => setOpen(false)}
                className="nannan-prompt-compose-modal"
                rootClassName="nannan-prompt-compose-modal-root"
                styles={{
                    container: {
                        maxHeight: "min(94vh, 1020px)",
                        height: "min(94vh, 1020px)",
                        paddingBottom: 12,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    },
                    header: { marginBottom: 6, flex: "none" },
                    body: {
                        fontSize: 13,
                        lineHeight: 1.4,
                        flex: 1,
                        minHeight: 0,
                        overflow: "hidden",
                        paddingTop: 0,
                        display: "flex",
                        flexDirection: "column",
                    },
                }}
            >
                <style>{`
                    .nannan-prompt-compose-modal-root .ant-modal {
                        max-width: calc(100vw - 16px);
                        top: 20px !important;
                        padding-bottom: 0 !important;
                        transform: none !important;
                        transition: none !important;
                    }
                    .nannan-prompt-compose-modal-root .ant-modal-container,
                    .nannan-prompt-compose-modal-root .ant-modal-content {
                        height: min(94vh, 1020px) !important;
                        max-height: min(94vh, 1020px) !important;
                        display: flex !important;
                        flex-direction: column !important;
                        overflow: hidden !important;
                    }
                    .nannan-prompt-compose-modal-root .ant-modal-header {
                        flex: none !important;
                    }
                    .nannan-prompt-compose-modal-root .ant-modal-body {
                        flex: 1 1 auto !important;
                        min-height: 0 !important;
                        overflow: hidden !important;
                        display: flex !important;
                        flex-direction: column !important;
                    }
                    .nannan-prompt-compose-shell {
                        flex: 1 1 auto;
                        min-height: 0;
                        height: 100%;
                        display: flex;
                        flex-direction: column;
                        gap: 0;
                        overflow: hidden;
                        font-size: 13px;
                    }
                    /* 固定区刻意压矮：只留操作 + 一行状态 + 模板横滑 */
                    .nannan-prompt-compose-sticky {
                        flex: 0 0 auto;
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                        padding-bottom: 8px;
                        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
                        background: inherit;
                        z-index: 2;
                    }
                    .nannan-prompt-compose-toolbar {
                        display: flex;
                        flex-wrap: wrap;
                        align-items: center;
                        gap: 6px;
                    }
                    .nannan-prompt-compose-statusline {
                        display: flex;
                        flex-wrap: wrap;
                        align-items: center;
                        gap: 6px;
                        min-height: 28px;
                    }
                    .nannan-prompt-compose-pill {
                        display: inline-flex;
                        align-items: center;
                        gap: 4px;
                        border-radius: 999px;
                        border: 1px solid;
                        padding: 2px 8px;
                        font-size: 11.5px;
                        line-height: 1.3;
                        white-space: nowrap;
                    }
                    .nannan-prompt-compose-templates-row {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        min-width: 0;
                    }
                    .nannan-prompt-compose-templates-scroll {
                        display: flex;
                        flex-wrap: nowrap;
                        gap: 6px;
                        min-width: 0;
                        overflow-x: auto;
                        overflow-y: hidden;
                        overscroll-behavior-x: contain;
                        scrollbar-width: thin;
                        padding-bottom: 2px;
                    }
                    .nannan-prompt-compose-templates-scroll .nannan-prompt-template-chip {
                        flex: 0 0 auto;
                        padding: 4px 10px;
                        font-size: 11.5px;
                    }
                    .nannan-prompt-compose-meta {
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                    }
                    /* 下方总滚动区：已选/预览/热词/搜索/词库都在这里正常展开 */
                    .nannan-prompt-compose-scroll {
                        flex: 1 1 auto;
                        min-height: 0;
                        overflow-x: hidden;
                        overflow-y: auto !important;
                        overscroll-behavior: contain;
                        scrollbar-gutter: stable;
                        -webkit-overflow-scrolling: touch;
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                        padding: 10px 4px 16px 0;
                    }
                    .nannan-prompt-compose-summary {
                        display: grid;
                        grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr);
                        gap: 12px;
                        align-items: start;
                    }
                    @media (max-width: 1100px) {
                        .nannan-prompt-compose-summary {
                            grid-template-columns: 1fr;
                        }
                    }
                    .nannan-prompt-compose-summary-col {
                        min-width: 0;
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                    }
                    .nannan-prompt-compose-browser {
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                        min-height: 320px;
                    }
                    .nannan-prompt-compose-browser-main {
                        display: grid;
                        grid-template-columns: 176px minmax(0, 1fr);
                        gap: 14px;
                        align-items: start;
                        min-height: 280px;
                    }
                    .nannan-prompt-compose-aside {
                        position: sticky;
                        top: 0;
                        align-self: start;
                        max-height: min(60vh, 560px);
                        overflow-x: hidden;
                        overflow-y: auto;
                        overscroll-behavior: contain;
                        scrollbar-gutter: stable;
                    }
                    .nannan-prompt-compose-groups {
                        min-height: 280px;
                        overflow: visible;
                    }
                    .nannan-prompt-tag-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                        gap: 10px;
                        align-items: stretch;
                    }
                    .nannan-prompt-tag-grid.compact {
                        grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
                        gap: 8px;
                    }
                    .nannan-prompt-tag-chip {
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: stretch;
                        min-height: 52px;
                        height: 100%;
                        width: 100%;
                        margin: 0;
                        padding: 9px 12px;
                        border-radius: 12px;
                        text-align: left;
                        transition: border-color 0.12s ease, background-color 0.12s ease, opacity 0.12s ease;
                    }
                    .nannan-prompt-tag-chip.compact {
                        min-height: 38px;
                        padding: 6px 10px;
                        border-radius: 10px;
                    }
                    .nannan-prompt-tag-chip .zh {
                        display: block;
                        font-size: 13px;
                        line-height: 1.3;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .nannan-prompt-tag-chip .en {
                        display: block;
                        margin-top: 3px;
                        font-size: 11px;
                        line-height: 1.25;
                        font-weight: 400;
                        opacity: 0.75;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .nannan-prompt-tag-chip.compact .zh {
                        font-size: 12px;
                    }
                    .nannan-prompt-tag-chip.compact .en {
                        display: none;
                    }
                    .nannan-prompt-tag-meta {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        margin-top: 4px;
                        min-height: 16px;
                    }
                    .nannan-prompt-panel {
                        border-radius: 14px;
                        border: 1px solid;
                        padding: 14px 16px;
                        min-height: 96px;
                    }
                    .nannan-prompt-hot {
                        padding: 12px 14px;
                    }
                    .nannan-prompt-templates {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 8px;
                    }
                    .nannan-prompt-template-chip {
                        border-radius: 999px;
                        border: 1px solid;
                        padding: 6px 12px;
                        font-size: 12px;
                        line-height: 1.25;
                        cursor: pointer;
                        transition: opacity 0.12s ease, background-color 0.12s ease;
                    }
                    .nannan-prompt-template-chip:hover {
                        opacity: 0.88;
                    }
                    .nannan-prompt-completeness {
                        border-radius: 14px;
                        border: 1px solid;
                        padding: 12px 14px;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }
                    .nannan-prompt-completeness-item {
                        display: flex;
                        flex-wrap: wrap;
                        align-items: center;
                        gap: 8px;
                        font-size: 12.5px;
                        line-height: 1.45;
                    }
                    .nannan-prompt-scroll {
                        overflow-x: hidden;
                        overflow-y: auto;
                        overscroll-behavior: contain;
                        scrollbar-gutter: stable;
                        -webkit-overflow-scrolling: touch;
                    }
                `}</style>

                <div
                    className="nannan-prompt-compose-shell"
                    onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                >
                    <div className="nannan-prompt-compose-sticky">
                        {/* Row 1: primary actions only */}
                        <div
                            className="nannan-prompt-compose-toolbar"
                            onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                        >
                            <Button size="small" onClick={() => setSelectOpen(true)}>
                                完整提示词库
                            </Button>
                            <Button size="small" disabled={!selectedTags.length} onClick={clearAllSelected}>
                                清空已选
                            </Button>
                            <Button size="small" type="primary" disabled={!selectedTags.length} onClick={appendSelected}>
                                追加 {selectedTags.length}
                            </Button>
                            {onGenerate ? (
                                <Button size="small" type="primary" disabled={!selectedTags.length && !value.trim()} onClick={generateNow}>
                                    组合并生成
                                </Button>
                            ) : null}
                            <button
                                type="button"
                                className="inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] transition hover:opacity-80"
                                style={{
                                    borderColor: smartCompose ? theme.node.text : theme.node.stroke,
                                    background: smartCompose ? theme.node.fill : "transparent",
                                    color: theme.node.text,
                                }}
                                onClick={() => setSmartCompose((current) => !current)}
                                title="互斥词自动剔除 / 语义补洞"
                            >
                                <WandSparkles className="size-3 opacity-80" />
                                消歧 {smartCompose ? "开" : "关"}
                            </button>
                            <div className="ml-auto flex flex-wrap items-center gap-1">
                                {[
                                    { key: "part", label: "精修", on: partRefine, set: setPartRefine },
                                    { key: "face", label: "脸", on: faceRefine, set: setFaceRefine },
                                    { key: "skirt", label: "裙", on: skirtRefine, set: setSkirtRefine },
                                    { key: "hair", label: "发", on: hairRefine, set: setHairRefine },
                                ].map((item) => (
                                    <button
                                        key={item.key}
                                        type="button"
                                        className="rounded-full border px-1.5 py-0.5 text-[11px] transition hover:opacity-80"
                                        style={{
                                            borderColor: item.on ? theme.node.text : theme.node.stroke,
                                            background: item.on ? theme.node.fill : "transparent",
                                            color: theme.node.text,
                                            opacity: !partRefine && item.key !== "part" ? 0.4 : 1,
                                        }}
                                        onClick={() => item.set((current: boolean) => !current)}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Row 2: one status line — glanceable, not a wall of text */}
                        <div
                            className="nannan-prompt-compose-statusline"
                            onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                        >
                            <span
                                className="nannan-prompt-compose-pill"
                                style={{
                                    borderColor: pipelineStatus.poseChange ? "rgba(52,211,153,0.45)" : theme.node.stroke,
                                    background: pipelineStatus.poseChange ? "rgba(52,211,153,0.12)" : theme.node.panel,
                                    color: pipelineStatus.poseChange ? "#34d399" : theme.node.muted,
                                    fontWeight: 600,
                                }}
                                title="参考图 + 大改姿势时走 FaceID 换姿链"
                            >
                                {pipelineStatus.poseChange ? "换姿链·开" : "换姿链·关"}
                                {pipelineStatus.poseFamily !== "none" ? ` · ${pipelineStatus.poseFamily}` : ""}
                            </span>
                            <span
                                className="nannan-prompt-compose-pill"
                                style={{
                                    borderColor:
                                        hasReferenceImages && (identityPack.weak || !pipelineStatus.identityEvidence.hair || !pipelineStatus.identityEvidence.eyes)
                                            ? "rgba(251,191,36,0.5)"
                                            : hasReferenceImages
                                              ? "rgba(52,211,153,0.4)"
                                              : theme.node.stroke,
                                    background:
                                        hasReferenceImages && (identityPack.weak || !pipelineStatus.identityEvidence.hair || !pipelineStatus.identityEvidence.eyes)
                                            ? "rgba(251,191,36,0.1)"
                                            : theme.node.panel,
                                    color:
                                        hasReferenceImages && (identityPack.weak || !pipelineStatus.identityEvidence.hair || !pipelineStatus.identityEvidence.eyes)
                                            ? "#fbbf24"
                                            : theme.node.muted,
                                }}
                                title="有图≠有文字发色瞳色；组合器只读节点文字身份源"
                            >
                                {hasReferenceImages
                                    ? identityPack.weak || !pipelineStatus.identityEvidence.hair || !pipelineStatus.identityEvidence.eyes
                                        ? "身份弱·需补发色瞳色"
                                        : "身份够·可换姿"
                                    : "文生图模式"}
                                {" · "}
                                发{pipelineStatus.identityEvidence.hair ? "✓" : "·"}瞳
                                {pipelineStatus.identityEvidence.eyes ? "✓" : "·"}装
                                {pipelineStatus.identityEvidence.outfit ? "✓" : "·"}
                            </span>
                            {smartCompose ? (
                                <span className="nannan-prompt-compose-pill" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.faint }} title="红=冲突 黄=覆盖 绿=增强">
                                    <span style={{ color: "#f87171" }}>●</span>冲突
                                    <span style={{ color: "#fbbf24", marginLeft: 4 }}>●</span>覆盖
                                    <span style={{ color: "#34d399", marginLeft: 4 }}>●</span>增强
                                </span>
                            ) : null}
                            <button
                                type="button"
                                className="nannan-prompt-compose-pill cursor-pointer"
                                style={{
                                    borderColor: headerDetailOpen ? theme.node.text : theme.node.stroke,
                                    background: headerDetailOpen ? theme.node.fill : "transparent",
                                    color: theme.node.muted,
                                }}
                                onClick={() => setHeaderDetailOpen((v) => !v)}
                            >
                                {headerDetailOpen ? "收起链路" : "链路详情"}
                            </button>
                        </div>

                        {headerDetailOpen ? (
                            <div
                                className="nannan-prompt-compose-meta rounded-xl border px-2.5 py-2 text-[11.5px] leading-5"
                                style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}
                            >
                                <div className="flex flex-wrap gap-x-2 gap-y-1">
                                    <span>表情:{pipelineStatus.expressionFamily}</span>
                                    {identitySeedPreview ? (
                                        <span>节点身份源 {identitySeedPreview.length} 字</span>
                                    ) : hasReferenceImages ? (
                                        <span style={{ color: "#fbbf24" }}>节点无文字身份源</span>
                                    ) : (
                                        <span>无 identity_prompt</span>
                                    )}
                                </div>
                                {pipelineStatus.gatewayHints?.length ? (
                                    <div className="mt-1 opacity-85">网关：{pipelineStatus.gatewayHints.join(" · ")}</div>
                                ) : null}
                                {pipelineStatus.densifyPreview ? (
                                    <div className="nannan-prompt-scroll mt-1 max-h-12 whitespace-pre-wrap break-words" style={{ color: theme.node.text }}>
                                        densify：{pipelineStatus.densifyPreview}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {/* Row 3: scene templates as single horizontal rail */}
                        {sceneTemplates.length ? (
                            <div className="nannan-prompt-compose-templates-row">
                                <span style={{ color: theme.node.faint, fontSize: 11, flex: "0 0 auto" }}>模板</span>
                                <div className="nannan-prompt-compose-templates-scroll">
                                    {sceneTemplates.map((template, index) => (
                                        <button
                                            key={template.id || `scene-template-${index}`}
                                            type="button"
                                            className="nannan-prompt-template-chip"
                                            title={`${template.zh}\n自动并入身份包`}
                                            style={{
                                                borderColor: theme.node.stroke,
                                                background: theme.node.panel,
                                                color: theme.node.text,
                                            }}
                                            onClick={() => applySceneTemplate(template)}
                                        >
                                            {template.shortLabel}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div
                        className="nannan-prompt-compose-scroll"
                        onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                    >
                    {/* 身份区放进滚动：固定区不再被长说明/粘贴框撑高 */}
                    <div
                        className="rounded-xl border px-3 py-2.5 space-y-2"
                        style={{
                            borderColor:
                                hasReferenceImages && (identityPack.weak || !pipelineStatus.identityEvidence.hair || !pipelineStatus.identityEvidence.eyes)
                                    ? "rgba(251,191,36,0.4)"
                                    : theme.node.stroke,
                            background: theme.node.panel,
                        }}
                    >
                        <div className="flex flex-wrap items-center gap-2" style={{ color: theme.node.text, fontSize: 12.5, fontWeight: 600 }}>
                            <span>角色身份</span>
                            {hasReferenceImages ? (
                                identityPack.weak || !pipelineStatus.identityEvidence.hair || !pipelineStatus.identityEvidence.eyes ? (
                                    <span style={{ color: "#fbbf24", fontWeight: 500, fontSize: 12 }}>有图，但文字缺具体发色/瞳色（不会看图识色）</span>
                                ) : (
                                    <span style={{ color: "#34d399", fontWeight: 500, fontSize: 12 }}>文字身份源可用</span>
                                )
                            ) : (
                                <span style={{ color: "#93c5fd", fontWeight: 500, fontSize: 12 }}>文生图草稿</span>
                            )}
                        </div>
                        <div className="nannan-prompt-templates">
                            <button
                                type="button"
                                className="nannan-prompt-template-chip cursor-pointer"
                                title={identityPack.summary || "一键并入身份包"}
                                disabled={!identityPack.tags.length}
                                style={{
                                    borderColor: hasReferenceImages && !identityPack.weak ? "rgba(52,211,153,0.55)" : theme.node.stroke,
                                    background: hasReferenceImages && !identityPack.weak ? "rgba(52,211,153,0.12)" : "transparent",
                                    color: theme.node.text,
                                    opacity: identityPack.tags.length ? 1 : 0.45,
                                    fontWeight: 600,
                                }}
                                onClick={applyIdentityPack}
                            >
                                {identitySeedPreview || hasReferenceImages ? "补身份包" : "锁角色草稿"}
                            </button>
                            {hasReferenceImages && onIdentitySeedCommit ? (
                                <button
                                    type="button"
                                    className="nannan-prompt-template-chip cursor-pointer"
                                    title="把外观词写回本图片节点"
                                    style={{
                                        borderColor: "rgba(96,165,250,0.65)",
                                        background: "rgba(59,130,246,0.14)",
                                        color: theme.node.text,
                                        fontWeight: 600,
                                    }}
                                    onClick={commitIdentitySeedFromSelection}
                                >
                                    写回本图
                                </button>
                            ) : null}
                            {identityPack.evidence.slice(0, 6).map((term, index) => (
                                <button
                                    key={`identity-evidence-${index}-${term}`}
                                    type="button"
                                    className="nannan-prompt-template-chip"
                                    title={`点选加入：${term}`}
                                    style={{
                                        borderColor: selected[term] ? theme.node.text : theme.node.stroke,
                                        background: selected[term] ? theme.node.fill : "transparent",
                                        color: theme.node.text,
                                    }}
                                    onClick={() => toggleEvidenceTerm(term)}
                                >
                                    {term}
                                </button>
                            ))}
                        </div>
                        {(identityPack.weak || !pipelineStatus.identityEvidence.hair || !pipelineStatus.identityEvidence.eyes || !hasReferenceImages) ? (
                            <div className="space-y-1.5">
                                <div style={{ color: theme.node.muted, fontSize: 12, lineHeight: 1.4 }}>
                                    在下面粘贴具体外观，例如：long brown hair with teal tips, blue eyes, white dress
                                </div>
                                <Input.TextArea
                                    value={identityDraft}
                                    onChange={(event) => setIdentityDraft(event.target.value)}
                                    placeholder="例：long brown hair with teal tips, blue eyes, white dress, detailed face"
                                    autoSize={{ minRows: 2, maxRows: 3 }}
                                    style={{
                                        background: theme.node.fill,
                                        borderColor: theme.node.stroke,
                                        color: theme.node.text,
                                    }}
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        className="nannan-prompt-template-chip cursor-pointer"
                                        style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}
                                        onClick={() => setIdentityDraft("long brown hair with teal tips, blue eyes, white dress, detailed face")}
                                    >
                                        填入示例
                                    </button>
                                    <button
                                        type="button"
                                        className="nannan-prompt-template-chip cursor-pointer"
                                        style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text, fontWeight: 600 }}
                                        onClick={() => applyIdentityDraftText(identityDraft, false)}
                                    >
                                        加入已选
                                    </button>
                                    <button
                                        type="button"
                                        className="nannan-prompt-template-chip cursor-pointer"
                                        style={{
                                            borderColor: "rgba(52,211,153,0.65)",
                                            background: "rgba(52,211,153,0.14)",
                                            color: theme.node.text,
                                            fontWeight: 600,
                                        }}
                                        onClick={() => applyIdentityDraftText(identityDraft, true)}
                                    >
                                        加入并写回本图
                                    </button>
                                </div>
                            </div>
                        ) : identityPack.summary ? (
                            <div className="nannan-prompt-scroll max-h-10 whitespace-pre-wrap break-words" style={{ color: theme.node.muted, fontSize: 12 }}>
                                {identityPack.summary}
                            </div>
                        ) : null}
                    </div>

                    <div
                        className="nannan-prompt-completeness"
                        style={{
                            borderColor:
                                completeness.level === "critical"
                                    ? "rgba(248,113,113,0.55)"
                                    : completeness.level === "warn"
                                      ? "rgba(251,191,36,0.5)"
                                      : "rgba(52,211,153,0.35)",
                            background: theme.node.panel,
                            color: theme.node.text,
                        }}
                    >
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: theme.node.text }}>
                            组合完整度：
                            {completeness.level === "ok" ? "良好" : completeness.level === "warn" ? "可优化" : "缺关键项"}
                            {completeness.poseFamily !== "none" ? ` · 体位族 ${completeness.poseFamily}` : ""}
                        </div>
                        {completeness.missing.length ? (
                            <div className="space-y-1.5">
                                {completeness.missing.map((item) => (
                                    <div key={item.id} className="nannan-prompt-completeness-item">
                                        <span style={{ color: item.severity === "critical" ? "#f87171" : "#fbbf24", fontWeight: 600 }}>
                                            {item.severity === "critical" ? "必须补" : "建议补"}
                                        </span>
                                        <span style={{ color: theme.node.muted }}>
                                            {item.label}：{item.suggestion}
                                        </span>
                                        {item.tags?.length ? (
                                            <button
                                                type="button"
                                                className="rounded-full border px-2 py-0.5 text-[11px] cursor-pointer hover:opacity-80"
                                                style={{ borderColor: theme.node.stroke, color: theme.node.text, background: theme.node.fill }}
                                                onClick={() => applySuggestedTags(item.tags, { label: item.label })}
                                            >
                                                一键补上
                                            </button>
                                        ) : (
                                            <span
                                                className="rounded-full border px-2 py-0.5 text-[11px]"
                                                style={{ borderColor: "rgba(251,191,36,0.45)", color: "#fbbf24", background: "transparent" }}
                                                title={item.suggestion}
                                            >
                                                需手写/换身份源
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ color: theme.node.muted, fontSize: 12.5 }}>缺项检查通过。点选标签会自动按「画质→人数→身份→服装→体位→行为→机位→表情」排序。</div>
                        )}
                        {completeness.tips.length ? (
                            <div style={{ color: theme.node.faint, fontSize: 12 }}>
                                {completeness.tips.map((tip, index) => (
                                    <div key={`tip-${index}-${tip}`}>• {tip}</div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <div
                        className="nannan-prompt-compose-summary"
                        onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                    >
                        <div className="nannan-prompt-compose-summary-col">
{selectedTags.length ? (
                        <div className="nannan-prompt-panel space-y-2" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            <div className="nannan-prompt-panel-title" style={{ color: theme.node.faint, fontSize: 12, lineHeight: "16px" }}>
                                已选 {selectedTags.length} 个 · 点标签 X 取消单个 · 清空请用「清空已选」
                            </div>
                            <SelectedLane title="前缀" tags={selectedPrefix} theme={theme} onToggle={toggleTag} empty="未选画质前缀" />
                            <SelectedLane title="主体 / 动作 / 场景" tags={selectedCore} theme={theme} onToggle={toggleTag} empty="未选主体内容" />
                            <SelectedLane title="后缀" tags={selectedSuffix} theme={theme} onToggle={toggleTag} empty="未选画质/氛围后缀" />
                        </div>
                    ) : (
                        <div className="nannan-prompt-panel" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.faint, fontSize: 12 }}>
                            尚未选择标签。从下方词库点选后会出现在这里；右键不会清空。
                        </div>
                    )}
{composed.prompt ? (
                        <div className="nannan-prompt-panel space-y-1.5" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            <div className="flex items-center gap-1.5" style={{ color: theme.node.faint, fontSize: 12, lineHeight: "16px" }}>
                                <Sparkles className="size-3" />
                                组合预览{smartCompose ? "（智能消歧后）" : ""}
                            </div>
                            <div className="whitespace-pre-wrap break-words text-[13px] leading-6" style={{ color: theme.node.text }}>
                                {composed.prompt}
                            </div>
                        </div>
                    ) : (
                        <div className="nannan-prompt-panel" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.faint, fontSize: 12 }}>
                            组合预览会显示在这里，选标签后自动生成。
                        </div>
                    )}
                        </div>
                        <div className="nannan-prompt-compose-summary-col">
{composed.removed.length || composed.notes.length ? (
                        <div
                            className="nannan-prompt-panel space-y-1.5 text-[12.5px] leading-6"
                            style={{ borderColor: theme.node.stroke, color: theme.node.muted }}
                        >
                            {composed.notes.map((note) => (
                                <div key={`note-${String(note).slice(0,40)}`}>• {note}</div>
                            ))}
                            {composed.removed.slice(0, 8).map((item) => (
                                <div key={`${item.token}-${item.reason}`}>
                                    • 已剔除 <span style={{ color: theme.node.text }}>{item.token}</span>：{item.reason}
                                </div>
                            ))}
                            {composed.removed.length > 8 ? <div>• 另有 {composed.removed.length - 8} 个冲突词已剔除</div> : null}
                        </div>
                    ) : (
                        <div className="nannan-prompt-panel" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.faint, fontSize: 12 }}>
                            智能消歧说明与剔除结果会显示在这里。
                        </div>
                    )}
                        </div>
                    </div>

                    <div className="nannan-prompt-compose-browser">
                    {hotTags.length ? (
                        <div className="nannan-prompt-hot space-y-2 rounded-xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            <div className="flex items-center gap-1.5" style={{ color: theme.node.faint, fontSize: 12, lineHeight: "16px" }}>
                                <Flame className="size-3" /> 热词（按使用次数排序）
                            </div>
                            <div className="nannan-prompt-tag-grid compact">
                                {hotTags.map(({ tag, count }, index) => (
                                    <TagChip
                                        key={`hot-${index}-${tag.en}`}
                                        tag={tag}
                                        count={count}
                                        active={Boolean(selected[tag.en])}
                                        hint={relationHints[tag.en]}
                                        theme={theme}
                                        compact
                                        onToggle={(event) => toggleTag(tag, event)}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <div className="shrink-0">
                    <Input size="small" allowClear placeholder="搜索中文或英文标签" value={query} onChange={(event) => setQuery(event.target.value)} />
                    </div>
                    {loadError ? <div className="shrink-0 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">{loadError}</div> : null}
                    {loading ? (
                        <div className="flex items-center gap-2 py-4 text-xs" style={{ color: theme.node.muted }}>
                            <Loader2 className="size-3.5 animate-spin" /> 正在读取标签词库…
                        </div>
                    ) : null}

                    <div className="nannan-prompt-compose-browser-main">
                        <aside
                            className="nannan-prompt-compose-aside thin-scrollbar w-40 shrink-0 space-y-1 rounded-2xl border p-2"
                            style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
                        >
                            {categories.map((category) => {
                                const activeCat = category.id === active?.id;
                                return (
                                    <button
                                        key={category.id}
                                        type="button"
                                        className="block w-full cursor-pointer rounded-lg px-2 py-1.5 text-left transition"
                                        style={{
                                            background: activeCat ? theme.node.fill : "transparent",
                                            color: theme.node.text,
                                            boxShadow: activeCat ? `inset 0 0 0 1px ${theme.node.stroke}` : "none",
                                            fontSize: 12,
                                            lineHeight: "16px",
                                            padding: "8px 10px",
                                        }}
                                        onClick={() => setActiveCategory(category.id)}
                                    >
                                        {category.label}
                                    </button>
                                );
                            })}
                        </aside>

                        <div className="nannan-prompt-compose-groups min-w-0 space-y-4 pr-1">
                            {sectionedGroups.map((group) => (
                                <section
                                    key={group.key}
                                    className="rounded-xl border px-3 py-3"
                                    style={{
                                        borderColor: zoneBorder(group.zone, theme),
                                        background: zoneBackground(group.zone, theme),
                                    }}
                                >
                                    <div className="mb-1.5 flex items-end justify-between gap-2">
                                        <div>
                                            <div className="font-medium tracking-wide" style={{ color: theme.node.text, fontSize: 12.5, lineHeight: "16px" }}>
                                                {group.title}
                                            </div>
                                            {group.subtitle ? (
                                                <div className="leading-4" style={{ color: theme.node.faint, fontSize: 11, lineHeight: "15px" }}>
                                                    {group.subtitle}
                                                </div>
                                            ) : null}
                                        </div>
                                        <span className="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums" style={{ background: theme.node.fill, color: theme.node.muted }}>
                                            {group.tags.length}
                                        </span>
                                    </div>
                                    <div className="nannan-prompt-tag-grid">
                                        {group.tags.map((tag, tagIndex) => (
                                            <TagChip
                                                key={`${group.key}-${tagIndex}-${tag.en}`}
                                                tag={tag}
                                                active={Boolean(selected[tag.en])}
                                                hint={relationHints[tag.en]}
                                                theme={theme}
                                                onToggle={(event) => toggleTag(tag, event)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            ))}
                            {!sectionedGroups.length && !loading ? (
                                <div className="py-10 text-center text-xs" style={{ color: theme.node.muted }}>
                                    没有匹配标签，换个分类或关键词试试
                                </div>
                            ) : null}
                        </div>
                    </div>
                    </div>
                    </div>
                </div>
            </Modal>
        </>
    );
}

function SelectedLane({
    title,
    tags,
    theme,
    onToggle,
    empty,
}: {
    title: string;
    tags: PromptLibraryTag[];
    theme: CanvasTheme;
    onToggle: (tag: PromptLibraryTag, event?: { button?: number }) => void;
    empty: string;
}) {
    return (
        <div className="space-y-1.5">
            <div className="text-[12px] font-medium tracking-wide" style={{ color: theme.node.faint }}>
                {title}
            </div>
            {tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag, index) => (
                        <button
                            key={`selected-${index}-${tag.en}`}
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border transition hover:opacity-70"
                            style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.text, fontSize: 12, lineHeight: 1.25, padding: "4px 9px", fontWeight: 550 }}
                            onClick={(event) => {
                                if (event.button !== 0) return;
                                onToggle(tag, event);
                            }}
                            onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onAuxClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                        >
                            {tag.zh || tag.en}
                            <X className="size-3.5 opacity-60" />
                        </button>
                    ))}
                </div>
            ) : (
                <div className="text-[12px]" style={{ color: theme.node.faint }}>
                    {empty}
                </div>
            )}
        </div>
    );
}

function TagChip({
    tag,
    count,
    active,
    hint,
    theme,
    compact,
    onToggle,
}: {
    tag: PromptLibraryTag;
    count?: number;
    active: boolean;
    hint?: TagRelationHint;
    theme: CanvasTheme;
    compact?: boolean;
    onToggle: (event?: { button?: number }) => void;
}) {
    const blocked = Boolean(!active && hint?.severity === "block");
    const boost = Boolean(!active && hint?.severity === "boost");
    const warn = Boolean(!active && hint?.severity === "warn");
    const borderColor = active
        ? theme.node.activeStroke
        : blocked
          ? "rgba(248,113,113,0.42)"
          : boost
            ? "rgba(52,211,153,0.55)"
            : warn
              ? "rgba(251,191,36,0.55)"
              : theme.node.stroke;
    const background = active
        ? theme.node.fill
        : blocked
          ? "rgba(248,113,113,0.07)"
          : boost
            ? "rgba(52,211,153,0.08)"
            : warn
              ? "rgba(251,191,36,0.08)"
              : theme.node.panel;
    const title = hint
        ? `${hint.severity === "block" ? "冲突" : hint.severity === "boost" ? "增强" : "覆盖"}：${hint.reason}${hint.against?.length ? `（相对 ${hint.against.join("、")}）` : ""}`
        : `${tag.zh || ""} ${tag.en}`.trim();
    const primary = tag.zh || tag.en;
    const secondary = tag.zh ? tag.en : "";

    return (
        <button
            type="button"
            title={title}
            disabled={blocked}
            aria-disabled={blocked}
            onClick={(event) => {
                if (event.button !== 0) return;
                onToggle(event);
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
            onAuxClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
            className={`nannan-prompt-tag-chip${compact ? " compact" : ""}`}
            style={{
                cursor: blocked ? "not-allowed" : "pointer",
                border: `1px solid ${borderColor}`,
                background,
                color: blocked ? theme.node.faint : theme.node.text,
                opacity: blocked ? 0.42 : 1,
                boxShadow: active
                    ? `inset 0 0 0 1px ${theme.node.activeStroke}`
                    : boost
                      ? "0 0 0 1px rgba(52,211,153,0.14)"
                      : "none",
            }}
        >
            <span className="zh" style={{ fontWeight: active ? 650 : 560 }}>
                {primary}
            </span>
            {!compact && secondary ? (
                <span className="en" style={{ color: theme.node.muted }}>
                    {secondary}
                </span>
            ) : null}
            {typeof count === "number" || (hint && !active) ? (
                <span className="nannan-prompt-tag-meta">
                    {typeof count === "number" ? (
                        <span style={{ fontSize: 10, color: theme.node.faint }}>×{count}</span>
                    ) : null}
                    {hint && !active ? (
                        <span
                            style={{
                                fontSize: 10,
                                borderRadius: 4,
                                padding: "0 4px",
                                lineHeight: "14px",
                                color: hint.severity === "block" ? "#f87171" : hint.severity === "boost" ? "#34d399" : "#fbbf24",
                                background:
                                    hint.severity === "block"
                                        ? "rgba(248,113,113,0.12)"
                                        : hint.severity === "boost"
                                          ? "rgba(52,211,153,0.12)"
                                          : "rgba(251,191,36,0.12)",
                            }}
                        >
                            {hint.severity === "block" ? "冲突" : hint.severity === "boost" ? "增强" : "覆盖"}
                        </span>
                    ) : null}
                </span>
            ) : null}
        </button>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: color }} />
            <span>{label}</span>
        </span>
    );
}

function zoneBorder(zone: SectionedGroup["zone"], theme: CanvasTheme) {
    if (zone === "prefix") return "rgba(56,189,248,0.35)";
    if (zone === "suffix") return "rgba(167,139,250,0.35)";
    if (zone === "core") return "rgba(52,211,153,0.22)";
    return theme.node.stroke;
}

function zoneBackground(zone: SectionedGroup["zone"], theme: CanvasTheme) {
    if (zone === "prefix") return "rgba(56,189,248,0.05)";
    if (zone === "suffix") return "rgba(167,139,250,0.05)";
    if (zone === "core") return "rgba(52,211,153,0.04)";
    return theme.node.panel;
}

function sectionGroupsForDisplay(categoryId: string, groups: PromptLibraryGroup[]): SectionedGroup[] {
    if (categoryId === "quality") {
        const prefix: PromptLibraryTag[] = [];
        const suffix: PromptLibraryTag[] = [];
        const style: PromptLibraryTag[] = [];
        for (const group of groups) {
            const label = group.label || "";
            if (/前缀|正面优化/i.test(label)) {
                prefix.push(...group.tags);
                continue;
            }
            if (/后缀|收尾/i.test(label)) {
                suffix.push(...group.tags);
                continue;
            }
            // “质量”混杂前缀/风格词，再按语义拆开
            for (const tag of group.tags) {
                if (isQualityPrefixTag(tag) || /^(high quality)$/i.test(tag.en)) prefix.push(tag);
                else if (isQualitySuffixTag(tag)) suffix.push(tag);
                else style.push(tag);
            }
        }
        const result: SectionedGroup[] = [];
        if (prefix.length) {
            result.push({
                key: "quality-prefix",
                title: "正面优化 · 前缀",
                subtitle: "放在提示词最前，负责质量锚点",
                zone: "prefix",
                tags: uniqueTags(prefix),
            });
        }
        if (style.length) {
            result.push({
                key: "quality-style",
                title: "成像风格",
                subtitle: "照片 / 插画 / 胶片气质，与主体内容并列",
                zone: "core",
                tags: uniqueTags(style),
            });
        }
        if (suffix.length) {
            result.push({
                key: "quality-suffix",
                title: "画质收尾 · 后缀",
                subtitle: "放在提示词末尾，补光影与细节",
                zone: "suffix",
                tags: uniqueTags(suffix),
            });
        }
        return result;
    }

    return groups.map((group, index) => ({
        key: `${group.label}-${index}`,
        title: group.label,
        zone: "other" as const,
        tags: group.tags,
    }));
}

function uniqueTags(tags: PromptLibraryTag[]) {
    const seen = new Set<string>();
    const result: PromptLibraryTag[] = [];
    for (const tag of tags) {
        const key = tag.en.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

function matchSelectedFromPrompt(categories: PromptLibraryCategory[], prompt: string) {
    const tokens = new Set(
        (prompt || "")
            .split(/[,，]/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean),
    );
    const selected: Record<string, PromptLibraryTag> = {};
    if (!tokens.size) return selected;
    for (const category of categories) {
        for (const group of category.groups) {
            for (const tag of group.tags) {
                if (tokens.has(tag.en.toLowerCase())) selected[tag.en] = tag;
            }
        }
    }
    return selected;
}
