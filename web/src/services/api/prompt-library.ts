import axios from "axios";

import { type AiConfig } from "@/stores/use-config-store";
import { comfyGatewayBase, findComfyGatewayBase, isComfyModel } from "./comfy";

export type PromptLibraryTag = {
    en: string;
    zh?: string;
    orderWeight?: number;
    kind?: string;
    atomic?: boolean;
};

export type PromptLibraryGroup = {
    label: string;
    tags: PromptLibraryTag[];
};

export type PromptLibraryCategory = {
    id: string;
    label: string;
    groups: PromptLibraryGroup[];
};

export type PromptLibraryConflictFamily = {
    labelZh?: string;
    priority?: number;
    tags: string[];
};

export type PromptLibraryConflictGroup = {
    id: string;
    labelZh?: string;
    exclusive?: boolean;
    priority?: number;
    soft?: boolean;
    tags?: string[];
    conflictsWithAny?: string[];
    families?: Record<string, PromptLibraryConflictFamily | string[]>;
    resolve?: string;
    notes?: string;
};

export type PromptLibraryMeta = {
    version?: number | string;
    updatedAt?: string;
    aliases: Record<string, string>;
    conflictGroups: PromptLibraryConflictGroup[];
    sourceNotes: string[];
};

let cache: {
    baseUrl: string;
    fetchedAt: number;
    version?: number | string;
    categories: PromptLibraryCategory[];
    meta: PromptLibraryMeta;
} | null = null;

function mapCategories(
    categories: Array<{
        id?: string;
        label_zh?: string;
        groups?: Array<{
            label_zh?: string;
            tags?: Array<{ en?: string; zh?: string; order_weight?: number; kind?: string; atomic?: boolean }>;
        }>;
    }>,
): PromptLibraryCategory[] {
    return (categories || [])
        .map((category) => ({
            id: category.id || category.label_zh || "",
            label: category.label_zh || category.id || "未分类",
            groups: (category.groups || [])
                .map((group) => ({
                    label: group.label_zh || "标签",
                    tags: (group.tags || [])
                        .map((tag) => ({
                            en: tag.en || "",
                            zh: tag.zh,
                            orderWeight: tag.order_weight,
                            kind: tag.kind,
                            atomic: tag.atomic,
                        }))
                        .filter((tag) => tag.en),
                }))
                .filter((group) => group.tags.length),
        }))
        .filter((category) => category.id && category.groups.length);
}

function mapMeta(data: {
    version?: number | string;
    updated_at?: string;
    aliases?: Record<string, string>;
    conflict_groups?: Array<Record<string, unknown>>;
    source_notes?: string[];
}): PromptLibraryMeta {
    return {
        version: data.version,
        updatedAt: data.updated_at,
        aliases: data.aliases || {},
        conflictGroups: (data.conflict_groups || []).map((group) => ({
            id: String(group.id || ""),
            labelZh: typeof group.label_zh === "string" ? group.label_zh : undefined,
            exclusive: Boolean(group.exclusive),
            priority: typeof group.priority === "number" ? group.priority : undefined,
            soft: Boolean(group.soft),
            tags: Array.isArray(group.tags) ? (group.tags as string[]) : [],
            conflictsWithAny: Array.isArray(group.conflicts_with_any) ? (group.conflicts_with_any as string[]) : undefined,
            families: (group.families as PromptLibraryConflictGroup["families"]) || undefined,
            resolve: typeof group.resolve === "string" ? group.resolve : undefined,
            notes: typeof group.notes === "string" ? group.notes : undefined,
        })),
        sourceNotes: Array.isArray(data.source_notes) ? data.source_notes : [],
    };
}

export async function fetchPromptLibrary(config: AiConfig, model: string) {
    const packed = await fetchPromptLibraryPack(config, model);
    return packed.categories;
}

export async function fetchPromptLibraryPack(config: AiConfig, model: string) {
    // 提示词库挂在本地 ComfyUI 网关上；当前模型不是 comfy 渠道时回落到任一 comfy 渠道，避免打到远程模型渠道 404
    const baseUrl = isComfyModel(model) ? comfyGatewayBase(config, model) : findComfyGatewayBase(config);
    if (!baseUrl) throw new Error("未找到本地 ComfyUI 网关渠道，无法加载提示词库");
    if (cache && cache.baseUrl === baseUrl && Date.now() - cache.fetchedAt < 60_000) {
        return { categories: cache.categories, meta: cache.meta };
    }
    const response = await axios.get<{
        version?: number | string;
        updated_at?: string;
        aliases?: Record<string, string>;
        conflict_groups?: Array<Record<string, unknown>>;
        source_notes?: string[];
        categories?: Array<{
            id?: string;
            label_zh?: string;
            groups?: Array<{
                label_zh?: string;
                tags?: Array<{ en?: string; zh?: string; order_weight?: number; kind?: string; atomic?: boolean }>;
            }>;
        }>;
    }>(`${baseUrl}/nannan/prompt-library`, { timeout: 15000 });

    const categories = mapCategories(response.data.categories || []);
    const meta = mapMeta(response.data);
    cache = {
        baseUrl,
        fetchedAt: Date.now(),
        version: meta.version,
        categories,
        meta,
    };
    return { categories, meta };
}

export function clearPromptLibraryCache() {
    cache = null;
}

const TAG_USAGE_KEY = "canvas.prompt.tagUsage";

function readTagUsage(): Record<string, number> {
    try {
        const parsed = JSON.parse(localStorage.getItem(TAG_USAGE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

export function tagUsageMap(): Record<string, number> {
    return readTagUsage();
}

export function bumpTagUsage(tags: string[]) {
    if (!tags.length) return;
    const usage = readTagUsage();
    for (const tag of tags) {
        const key = tag.toLowerCase();
        usage[key] = (usage[key] || 0) + 1;
    }
    try {
        localStorage.setItem(TAG_USAGE_KEY, JSON.stringify(usage));
    } catch {
        // ignore quota errors
    }
}
