import axios from "axios";

import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export type ComfyReferenceMode = {
    key: string;
    label: string;
    kind: string;
    description?: string;
    enabled: boolean;
};

export type ComfyLoraPreset = {
    key: string;
    label: string;
    type?: string;
    style?: string;
    compatibleFamilies: string[];
    enabled: boolean;
    triggerWords?: string[];
};

export type ComfyImagePreset = {
    key: string;
    label: string;
    family?: string;
    loraFamilies: string[];
    supports: string[];
    style?: string;
    bestFor?: string;
    tags?: string[];
    previewUrl?: string;
    recommendedLoras?: string[];
};

export type ComfyLoraProfile = {
    key: string;
    label: string;
    preset?: string;
    loras: string[];
    triggerWords?: string[];
    status?: string;
    notes?: string;
};

export type ComfyPresets = {
    referenceModes: ComfyReferenceMode[];
    loraPresets: ComfyLoraPreset[];
    imagePresets: Record<string, ComfyImagePreset>;
    recommendedLoraProfiles: ComfyLoraProfile[];
};

const CACHE_TTL_MS = 60_000;
let cache: { baseUrl: string; fetchedAt: number; data: ComfyPresets } | null = null;

function textValue(value: unknown, fallback = "") {
    return typeof value === "string" && value.trim() ? value : fallback;
}

function styleRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function resolvePreviewUrl(baseUrl: string, previewUrl: string) {
    if (!previewUrl) return undefined;
    return previewUrl.startsWith("http") ? previewUrl : `${baseUrl}${previewUrl.startsWith("/") ? "" : "/"}${previewUrl}`;
}

function descriptionText(value: unknown) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    return textValue(record.summary) || textValue(record.style_description) || textValue(record.best_for) || textValue(record.caveat) || undefined;
}

export function isComfyModel(model: string | undefined) {
    return Boolean(model && modelOptionName(model).toLowerCase().startsWith("comfy/"));
}

export function comfyPresetKey(model: string | undefined) {
    if (!model) return "";
    const name = modelOptionName(model);
    const body = name.toLowerCase().startsWith("comfy/") ? name.slice("comfy/".length) : name;
    return body.split("@")[0].trim().toLowerCase();
}

/** 本机 nannan / Comfy 网关默认地址（与 Mission_manager llama_ui_gateway 一致） */
const LOCAL_NANNAN_GATEWAY_FALLBACK = "http://127.0.0.1:8080";

function normalizeGatewayBase(url: string) {
    return url.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

/**
 * chatgpt-login-image-adapter（默认 17372）等非 nannan 适配器没有 /nannan/* 路由。
 * 本地模型浏览器若误用这些 baseUrl，会稳定 404。
 */
function isNannanCapableGatewayBase(baseUrl: string) {
    if (!baseUrl) return false;
    try {
        const url = new URL(baseUrl);
        const host = url.hostname.toLowerCase();
        if ((host === "127.0.0.1" || host === "localhost") && url.port === "17372") return false;
        return true;
    } catch {
        return Boolean(baseUrl.trim());
    }
}

function gatewayBaseFromChannelUrl(url: string) {
    const base = normalizeGatewayBase(url || "");
    return base && isNannanCapableGatewayBase(base) ? base : "";
}

export function comfyGatewayBase(config: AiConfig, model: string) {
    // 当前模型本身就是 comfy/*：优先走其渠道（且必须是 nannan 能力地址）
    if (isComfyModel(model)) {
        const base = gatewayBaseFromChannelUrl(resolveModelChannel(config, model).baseUrl);
        if (base) return base;
    }
    // 当前是 chatgpt-login / 云端图模时：绝不能用它们的 baseUrl 去打 /nannan/*
    return findComfyGatewayBase(config);
}

export async function fetchComfyPresets(config: AiConfig, model: string): Promise<ComfyPresets> {
    const baseUrl = comfyGatewayBase(config, model);
    if (!baseUrl) {
        throw new Error("未找到本地 ComfyUI 网关渠道。请在设置里添加 comfy/ 模型渠道（通常 http://127.0.0.1:8080），不要用 chatgpt-login 适配器地址");
    }
    if (cache && cache.baseUrl === baseUrl && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;
    let response;
    try {
        response = await axios.get<{
            reference_modes?: Record<string, { label?: unknown; kind?: string; description?: unknown; enabled?: boolean }>;
            lora_presets?: Record<string, { label?: unknown; type?: string; nannan_style?: unknown; compatible_families?: string[]; enabled?: boolean; trigger_words?: string[] }>;
            image_presets?: Record<string, { label?: unknown; family?: string; lora_families?: string[]; supports?: string[]; nannan_style?: unknown; enabled?: boolean; recommended_loras?: string[] }>;
            defaults?: Record<string, unknown>;
            recommended_lora_profiles?: Record<string, { label?: unknown; preset?: string; loras?: string[]; trigger_words?: string[]; status?: string; notes?: string }>;
        }>(`${baseUrl}/nannan/generation-presets`, { timeout: 15000 });
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            throw new Error(`本地模型档案接口 404：${baseUrl}/nannan/generation-presets。请确认 nannan 网关（默认 8080）在运行，且渠道不是 chatgpt-login 适配器（17372）`);
        }
        throw error;
    }
    const payload = response.data || {};
    const referenceModes = Object.entries(payload.reference_modes || {})
        .map(([key, value]) => ({
            key,
            label: textValue(value.label, key),
            kind: value.kind || key,
            description: descriptionText(value.description),
            enabled: value.enabled !== false,
        }))
        .filter((mode) => mode.enabled);
    const loraPresets = Object.entries(payload.lora_presets || {})
        .map(([key, value]) => ({
            key,
            label: textValue(value.label, key),
            type: value.type,
            style: descriptionText(value.nannan_style),
            compatibleFamilies: value.compatible_families || [],
            enabled: value.enabled !== false,
            triggerWords: value.trigger_words,
        }))
        .filter((lora) => lora.enabled);
    const imagePresets: Record<string, ComfyImagePreset> = {};
    for (const [key, value] of Object.entries(payload.image_presets || {})) {
        if (value.enabled === false) continue;
        const style = styleRecord(value.nannan_style);
        imagePresets[key] = {
            key,
            label: textValue(value.label, key),
            family: value.family,
            loraFamilies: value.lora_families || [],
            supports: value.supports || [],
            style: descriptionText(value.nannan_style),
            bestFor: textValue(style.best_for) || undefined,
            tags: Array.isArray(style.tags) ? (style.tags as unknown[]).filter((tag): tag is string => typeof tag === "string") : undefined,
            previewUrl: resolvePreviewUrl(baseUrl, textValue(style.preview_url)),
            recommendedLoras: value.recommended_loras,
        };
    }
    const recommendedLoraProfiles = Object.entries(payload.recommended_lora_profiles || {})
        .map(([key, value]) => ({
            key,
            label: textValue(value.label, key),
            preset: value.preset,
            loras: value.loras || [],
            triggerWords: value.trigger_words,
            status: value.status,
            notes: value.notes,
        }))
        .filter((profile) => profile.loras.length);
    const data = { referenceModes, loraPresets, imagePresets, recommendedLoraProfiles };
    cache = { baseUrl, fetchedAt: Date.now(), data };
    return data;
}

export function compatibleLoras(presets: ComfyPresets, presetKey: string) {
    const preset = presets.imagePresets[presetKey];
    if (!preset || !preset.loraFamilies.length) return presets.loraPresets;
    const families = new Set(preset.loraFamilies.map((item) => item.toLowerCase()));
    return presets.loraPresets.filter((lora) => !lora.compatibleFamilies.length || lora.compatibleFamilies.some((family) => families.has(family.toLowerCase())));
}

export function recommendedLoras(presets: ComfyPresets, presetKey: string) {
    const recommended = presets.imagePresets[presetKey]?.recommendedLoras;
    if (!Array.isArray(recommended)) return undefined;
    const compatible = new Set(compatibleLoras(presets, presetKey).map((lora) => lora.key));
    return recommended.filter((key) => compatible.has(key));
}

export function recommendedLoraProfiles(presets: ComfyPresets, presetKey: string) {
    const compatible = new Set(compatibleLoras(presets, presetKey).map((lora) => lora.key));
    return presets.recommendedLoraProfiles.filter((profile) => profile.preset === presetKey && profile.loras.some((key) => compatible.has(key)));
}

export async function defaultLorasForModel(config: AiConfig, model: string) {
    if (!isComfyModel(model)) return undefined;
    const presets = await fetchComfyPresets(config, model);
    return recommendedLoras(presets, comfyPresetKey(model));
}

export async function fetchLikedPresets(config: AiConfig, model: string): Promise<Set<string>> {
    const baseUrl = comfyGatewayBase(config, model);
    if (!baseUrl) return new Set();
    try {
        const response = await axios.get<{ liked?: string[] }>(`${baseUrl}/nannan/liked-presets`, { timeout: 10000 });
        return new Set(response.data.liked || []);
    } catch {
        return new Set();
    }
}

export async function saveLikedPresets(config: AiConfig, model: string, liked: Set<string>) {
    const baseUrl = comfyGatewayBase(config, model);
    if (!baseUrl) return;
    await axios.post(`${baseUrl}/nannan/liked-presets`, { liked: Array.from(liked) }, { timeout: 10000 });
}

const USAGE_STORE_KEY = "canvas.comfy.usage";

function readUsageMap(): Record<string, number> {
    try {
        const parsed = JSON.parse(localStorage.getItem(USAGE_STORE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

export function presetUsageCount(presetKey: string) {
    return readUsageMap()[presetKey] || 0;
}

export function bumpPresetUsage(presetKey: string) {
    if (!presetKey) return;
    const map = readUsageMap();
    map[presetKey] = (map[presetKey] || 0) + 1;
    localStorage.setItem(USAGE_STORE_KEY, JSON.stringify(map));
}

export type UpscaleModelOption = {
    name: string;
    scale: number;
};

export function findComfyGatewayBase(config: AiConfig) {
    const candidates: string[] = [];
    const push = (url: string) => {
        const base = gatewayBaseFromChannelUrl(url);
        if (base && !candidates.includes(base)) candidates.push(base);
    };

    if (isComfyModel(config.imageModel)) {
        push(resolveModelChannel(config, config.imageModel).baseUrl);
    }
    for (const model of config.imageModels || []) {
        if (isComfyModel(model)) push(resolveModelChannel(config, model).baseUrl);
    }
    for (const channel of config.channels || []) {
        if ((channel.models || []).some((model) => model.toLowerCase().startsWith("comfy/"))) {
            push(channel.baseUrl);
        }
    }
    if (candidates.length) return candidates[0];
    // 即使当前生图选的是 chatgpt-login，本地模型浏览器 / AI 超分仍应落到本机 nannan 网关
    return LOCAL_NANNAN_GATEWAY_FALLBACK;
}

export function upscaleModelScale(name: string) {
    const match = name.toLowerCase().match(/(?:^|[^0-9])([248])x|x([248])(?:[^0-9]|$)/);
    const value = Number(match?.[1] || match?.[2]);
    return value === 2 || value === 8 ? value : 4;
}

export async function fetchUpscaleModels(baseUrl: string): Promise<UpscaleModelOption[]> {
    const response = await axios.get<{ models?: string[] }>(`${baseUrl}/nannan/upscale-models`, { timeout: 15000 });
    return (response.data?.models || []).map((name) => ({ name, scale: upscaleModelScale(name) }));
}

export async function requestSuperResolve(baseUrl: string, modelName: string, dataUrl: string, options?: { signal?: AbortSignal }) {
    let payload: { ok?: boolean; media?: string[]; error?: string };
    try {
        const response = await axios.post<{ ok?: boolean; media?: string[]; error?: string }>(
            `${baseUrl}/nannan/upscale-image`,
            { model: modelName, image_url: dataUrl },
            { timeout: 600000, signal: options?.signal },
        );
        payload = response.data || {};
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const data = error.response?.data as { error?: string } | undefined;
            if (data?.error) throw new Error(data.error);
        }
        throw error;
    }
    const media = payload.media?.[0];
    if (!payload.ok || !media) throw new Error(payload.error || "AI 超分失败");
    const mediaUrl = media.startsWith("http") ? media : `${baseUrl}${media}`;
    const response = await fetch(mediaUrl, { signal: options?.signal });
    if (!response.ok) throw new Error(`读取超分结果失败（HTTP ${response.status}）`);
    return response.blob();
}
