import axios from "axios";

import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { CanvasOutpaintMode, CapabilityPreflightDecision, CapabilityRegistryResponse, WorkflowBinding } from "@/types/generation";

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
    enabled?: boolean;
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
let capabilityCache: { baseUrl: string; fetchedAt: number; data: CapabilityRegistryResponse } | null = null;

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
            recommended_lora_profiles?: Record<string, { label?: unknown; preset?: string; loras?: string[]; enabled?: boolean; trigger_words?: string[]; status?: string; notes?: string }>;
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
            // Gateway 档案里常用 notes 承载说明；兼容 description / notes 两种字段
            description: descriptionText(value.description ?? (value as { notes?: unknown }).notes),
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
            enabled: value.enabled !== false,
            triggerWords: value.trigger_words,
            status: value.status,
            notes: value.notes,
        }))
        .filter((profile) => profile.enabled && profile.loras.length);
    const data = { referenceModes, loraPresets, imagePresets, recommendedLoraProfiles };
    cache = { baseUrl, fetchedAt: Date.now(), data };
    return data;
}

export async function fetchComfyCapabilities(config: AiConfig, model: string): Promise<CapabilityRegistryResponse> {
    const baseUrl = comfyGatewayBase(config, model);
    if (!baseUrl) {
        throw new Error("未找到本地 ComfyUI 网关渠道，无法执行运行时能力预检");
    }
    if (capabilityCache && capabilityCache.baseUrl === baseUrl && Date.now() - capabilityCache.fetchedAt < CACHE_TTL_MS) {
        return capabilityCache.data;
    }
    let response;
    try {
        response = await axios.get<CapabilityRegistryResponse>(`${baseUrl}/api/v1/capabilities`, { timeout: 30000 });
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            throw new Error(`运行时能力接口 404：${baseUrl}/api/v1/capabilities。请更新并重启 Mission_manager Gateway`);
        }
        throw error;
    }
    if (
        response.data?.schemaVersion !== "1"
        || typeof response.data.runtime?.reachable !== "boolean"
        || !response.data.preflight
        || !Array.isArray(response.data.preflight.uncheckedLayers)
        || !Array.isArray(response.data.capabilities)
        || !Array.isArray(response.data.workflowBindings)
        || response.data.capabilities.some((item) => (
            typeof item.runtime?.runtimeReady !== "boolean"
            || typeof item.runtime.available !== "boolean"
            || typeof item.runtime.filesPresent !== "boolean"
            || typeof item.runtime.nodesPresent !== "boolean"
            || typeof item.runtime.workflowReady !== "boolean"
            || !Array.isArray(item.workflowBindingIds)
        ))
        || response.data.workflowBindings.some((item) => (
            typeof item.workflowExists !== "boolean"
            || !["", "workflow_missing", "invalid_workflow_json", "unsupported_workflow_shape"].includes(item.parseError)
            || !["checked", "unavailable"].includes(item.runtimeProbeStatus)
            || !Array.isArray(item.requiredNodeTypes)
            || !Array.isArray(item.missingNodeTypes)
            || !Array.isArray(item.requiredRuntimeAssets)
            || !item.inputCompatibility
            || !["compatible", "incompatible", "unavailable"].includes(item.inputCompatibility.status)
            || !Array.isArray(item.inputCompatibility.issues)
        ))
    ) {
        throw new Error("运行时能力接口返回了不受支持的契约");
    }
    capabilityCache = { baseUrl, fetchedAt: Date.now(), data: response.data };
    return response.data;
}

export function preflightComfyModel(registry: CapabilityRegistryResponse, model: string, kind: "image" | "video" = "image"): CapabilityPreflightDecision {
    const presetKey = comfyPresetKey(model);
    const capabilityId = `comfy.${kind}.${presetKey}`;
    const capability = registry.capabilities.find((item) => item.capabilityId === capabilityId);
    if (!registry.runtime.reachable) {
        return { status: "unavailable", capability, workflowBindings: [], reasons: ["ComfyUI 运行时不可达"] };
    }
    if (!capability) {
        return { status: "unavailable", workflowBindings: [], reasons: [`能力未登记：${capabilityId}`] };
    }
    const workflowBindings = registry.workflowBindings.filter((item) => capability.workflowBindingIds.includes(item.workflowBindingId));
    const primaryTemplateField = kind === "image" ? "txt2img_template" : "template";
    const primaryWorkflowBindings = workflowBindings.filter((item) => item.inputBindings.templateField === primaryTemplateField);
    const gateBindings = primaryWorkflowBindings.length ? primaryWorkflowBindings : workflowBindings;
    const reasons = registry.preflight.uncheckedLayers.map((item) => `尚未验证：${item}`);
    if (!capability.runtime.runtimeReady) {
        reasons.push(
            ...capability.runtime.missingNodeTypes.map((item) => `缺少节点：${item}`),
            ...capability.runtime.missingRuntimeAssets.map((item) => `缺少运行时资产：${item}`),
        );
    }
    if (capability.runtime.disabledReason) reasons.push(`能力已禁用：${capability.runtime.disabledReason}`);
    if (!workflowBindings.length) reasons.push("没有可用的 WorkflowBinding");
    for (const binding of gateBindings) {
        if (!binding.workflowExists) reasons.push(`WorkflowBinding 文件缺失：${binding.workflowFile}`);
        if (binding.parseError) reasons.push(`WorkflowBinding 解析失败：${binding.workflowFile} (${binding.parseError})`);
        if (binding.runtimeProbeStatus !== "checked") reasons.push(`WorkflowBinding 运行时探针不可用：${binding.workflowFile}`);
        for (const nodeType of binding.missingNodeTypes) reasons.push(`WorkflowBinding 缺少节点：${nodeType}`);
    }
    if (!capability.runtime.filesPresent) reasons.push("能力所需文件不完整");
    if (capability.runtime.loaderVisible !== true) reasons.push("Loader 未确认所需模型可见");
    if (!capability.runtime.nodesPresent) reasons.push("工作流节点未通过运行时检查");
    if (!capability.runtime.workflowReady) reasons.push("WorkflowBinding 未就绪");
    if (capability.runtime.smokeStatus !== "passed") reasons.push(`最小 smoke 尚未通过：${capability.runtime.smokeStatus}`);
    if (!capability.runtime.runtimeReady) {
        return { status: "unavailable", capability, workflowBindings, reasons };
    }
    return {
        status: reasons.length ? "degraded" : "ready",
        capability,
        workflowBindings,
        reasons,
    };
}

/** Canonicalize runtime asset paths for equality checks. */
export function normalizeAssetId(assetId: string) {
    return assetId.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

/**
 * Strip only known trailing diagnostic suffixes from Gateway missing-asset strings.
 * Current Mission_manager formats: "(not visible)", "(ComfyUI 未扫到)", "(Loader 无枚举)".
 * Must not strip version parentheses such as "model (v2).safetensors".
 */
export function normalizeMissingRuntimeAssetId(assetId: string) {
    return normalizeAssetId(assetId.replace(/\s+\((?:not visible|ComfyUI 未扫到|Loader 无枚举)\)\s*$/i, ""));
}

function workflowBindingFailureReasons(binding: WorkflowBinding, missingRuntimeAssets: string[] = []) {
    const missingAssetIds = new Set(missingRuntimeAssets.map(normalizeMissingRuntimeAssetId));
    return [
        ...(!binding.workflowExists ? [`WorkflowBinding 文件缺失：${binding.workflowFile}`] : []),
        ...(binding.parseError ? [`WorkflowBinding 解析失败：${binding.workflowFile} (${binding.parseError})`] : []),
        ...(binding.runtimeProbeStatus !== "checked" ? [`WorkflowBinding 运行时探针不可用：${binding.workflowFile}`] : []),
        ...binding.missingNodeTypes.map((item) => `WorkflowBinding 缺少节点：${item}`),
        ...binding.requiredRuntimeAssets.filter((asset) => missingAssetIds.has(normalizeAssetId(asset.assetId))).map((asset) => `WorkflowBinding 缺少运行时资产：${asset.assetId}`),
        ...(binding.inputCompatibility.status !== "compatible" ? [`WorkflowBinding 输入字段不兼容：${binding.workflowFile}`] : []),
    ];
}

/**
 * Outpaint 专项 gate：先复用模型级检查，再验证本次实际基础模板。
 * 现有 canvas_inpaint mutator 尚未在 Registry 中拆成独立 WorkflowBinding；在 operations 登记 outpaint 前保持 degraded，
 * 由 Gateway 提交阶段继续校验动态注入的 mask / Differential Diffusion / ImageCompositeMasked 节点。
 */
export function preflightComfyOutpaint(registry: CapabilityRegistryResponse, model: string, mode: CanvasOutpaintMode): CapabilityPreflightDecision {
    const base = preflightComfyModel(registry, model);
    if (base.status === "unavailable") return base;
    const templateField = mode === "full_body" ? "ipadapter_template" : "txt2img_template";
    const bindings = base.workflowBindings.filter((item) => item.inputBindings.templateField === templateField);
    const reasons = [...base.reasons];
    const optionalMissingRuntimeAssets = base.capability?.runtime.optionalMissingRuntimeAssets || [];
    if (!bindings.length) reasons.push(`没有可用的 ${templateField} WorkflowBinding`);
    const bindingDiagnostics = bindings.map((binding) => ({
        binding,
        failures: workflowBindingFailureReasons(binding, [...(base.capability?.runtime.missingRuntimeAssets || []), ...optionalMissingRuntimeAssets]),
    }));
    const healthyBinding = bindingDiagnostics.find((item) => !item.failures.length)?.binding;
    if (!healthyBinding) {
        reasons.push(...bindingDiagnostics.flatMap((item) => item.failures));
    } else if (bindingDiagnostics.some((item) => item.failures.length)) {
        reasons.push(...bindingDiagnostics.filter((item) => item.failures.length).flatMap((item) => item.failures.map((reason) => `未选候选：${reason}`)));
    }
    if (!base.capability?.operations.includes("outpaint")) {
        reasons.push("Registry 尚未把 canvas_inpaint 动态 mutator 登记为独立 outpaint 能力；Gateway 将在提交时继续校验");
    }
    const uniqueReasons = [...new Set(reasons)];
    return {
        ...base,
        status: !bindings.length || !healthyBinding ? "unavailable" : uniqueReasons.length ? "degraded" : "ready",
        workflowBindings: healthyBinding ? [healthyBinding] : bindings,
        reasons: uniqueReasons,
    };
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
    return presets.recommendedLoraProfiles.filter((profile) => profile.enabled !== false && profile.preset === presetKey && profile.loras.some((key) => compatible.has(key)));
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
    for (const channel of config.channels || []) {
        if ((channel.models || []).some((model) => model.capability === "image" && isComfyModel(model.name))) {
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
