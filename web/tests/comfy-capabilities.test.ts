import assert from "node:assert/strict";
import axios from "axios";

import { fetchComfyCapabilities, fetchComfyPresets, preflightComfyModel, preflightComfyOutpaint, recommendedLoraProfiles, type ComfyPresets } from "../src/services/api/comfy.ts";
import type { AiConfig } from "../src/stores/use-config-store.ts";
import type { CapabilityRegistryResponse, RegisteredModelCapability, WorkflowBinding } from "../src/types/generation.ts";

const binding: WorkflowBinding = {
    workflowBindingId: "comfy.image.demo:txt2img_template",
    capabilityId: "comfy.image.demo",
    workflowHash: "workflow-hash",
    workflowFile: "demo.json",
    workflowExists: true,
    parseError: "",
    runtimeProbeStatus: "checked",
    requiredNodeTypes: ["CheckpointLoaderSimple"],
    missingNodeTypes: [],
    requiredRuntimeAssets: [{ assetId: "models/checkpoints/demo.safetensors", sha256: "", loader: "CheckpointLoaderSimple" }],
    inputCompatibility: { status: "compatible", issues: [] },
    inputBindings: { presetKey: "demo", templateField: "txt2img_template" },
};

const capability: RegisteredModelCapability = {
    capabilityId: "comfy.image.demo",
    label: "Demo",
    publisher: "",
    sourceRepo: "",
    sha256: "",
    registryFingerprint: "registry-hash",
    architecture: "sdxl",
    operations: ["manual"],
    mediaTypes: ["image_generation"],
    validatedPairs: [],
    safetyMode: null,
    qualityTier: null,
    workflowBindingIds: [binding.workflowBindingId],
    productionDefault: true,
    runtime: {
        registryDeclared: true,
        filesPresent: true,
        loaderVisible: true,
        nodesPresent: true,
        workflowReady: true,
        runtimeReady: true,
        available: true,
        missingNodeTypes: [],
        missingRuntimeAssets: [],
        inputCompatibilityIssues: [],
        disabledReason: "",
        smokeStatus: "passed",
        smokeEvidence: {},
    },
};

const registry = (overrides: Partial<CapabilityRegistryResponse> = {}): CapabilityRegistryResponse => ({
    schemaVersion: "1",
    registryVersion: "1",
    runtime: { comfyUrl: "http://127.0.0.1:8188", reachable: true },
    capabilities: [capability],
    workflowBindings: [binding],
    preflight: {
        status: "ready",
        missingNodeTypes: [],
        missingRuntimeAssets: [],
        uncheckedLayers: [],
        capabilityCount: 1,
        unavailableCapabilityCount: 0,
    },
    ...overrides,
});

const capabilityConfig = (baseUrl: string) => ({
    baseUrl,
    apiKey: "",
    apiFormat: "openai",
    models: ["comfy/demo"],
    channels: [{
        id: baseUrl,
        name: "测试网关",
        baseUrl,
        apiKey: "",
        apiFormat: "openai",
        models: ["comfy/demo"],
    }],
}) as AiConfig;

const originalAxiosGet = axios.get;
const requestedUrls: string[] = [];
axios.get = (async (url: string) => {
    requestedUrls.push(url);
    if (url.startsWith("http://invalid.local")) {
        return { data: { ...registry(), schemaVersion: "2" } };
    }
    if (url.startsWith("http://missing.local")) {
        throw Object.assign(new Error("not found"), {
            isAxiosError: true,
            response: { status: 404 },
        });
    }
    if (url.startsWith("http://incompatible.local")) {
        const invalidBinding = { ...binding, inputCompatibility: undefined };
        return { data: registry({ workflowBindings: [invalidBinding as unknown as WorkflowBinding] }) };
    }
    if (url === "http://presets.local/nannan/generation-presets") {
        return {
            data: {
                image_presets: { demo: { label: "Demo", lora_families: ["sdxl"] } },
                lora_presets: { detail: { label: "Detail", compatible_families: ["sdxl"] } },
                recommended_lora_profiles: {
                    legacy: { label: "Legacy", preset: "demo", loras: ["detail"] },
                    disabled: { label: "Disabled", preset: "demo", loras: ["detail"], enabled: false },
                    enabled: { label: "Enabled", preset: "demo", loras: ["detail"], enabled: true },
                },
            },
        };
    }
    return { data: registry() };
}) as typeof axios.get;

try {
    const config = capabilityConfig("http://127.0.0.1:18080/v1/");
    const fetched = await fetchComfyCapabilities(config, "comfy/demo");
    const cached = await fetchComfyCapabilities(config, "comfy/demo");
    assert.equal(fetched.schemaVersion, "1");
    assert.strictEqual(cached, fetched);
    assert.deepEqual(
        requestedUrls.filter((url) => url === "http://127.0.0.1:18080/api/v1/capabilities"),
        ["http://127.0.0.1:18080/api/v1/capabilities"],
    );
    await assert.rejects(
        fetchComfyCapabilities(capabilityConfig("http://invalid.local/v1"), "comfy/demo"),
        /不受支持的契约/,
    );
    await assert.rejects(
        fetchComfyCapabilities(capabilityConfig("http://missing.local/v1"), "comfy/demo"),
        /运行时能力接口 404/,
    );
    await assert.rejects(
        fetchComfyCapabilities(capabilityConfig("http://incompatible.local/v1"), "comfy/demo"),
        /不受支持的契约/,
    );

    const presets = await fetchComfyPresets(capabilityConfig("http://presets.local/v1"), "comfy/demo");
    assert.deepEqual(presets.recommendedLoraProfiles.map((profile) => profile.key), ["legacy", "enabled"]);
} finally {
    axios.get = originalAxiosGet;
}

assert.equal(preflightComfyModel(registry(), "comfy/demo").status, "ready");
assert.deepEqual(
    preflightComfyModel(registry({ runtime: { comfyUrl: "http://127.0.0.1:8188", reachable: false } }), "comfy/demo").reasons,
    ["ComfyUI 运行时不可达"],
);
assert.match(preflightComfyModel(registry(), "comfy/missing").reasons[0], /能力未登记/);

const profilePresets: ComfyPresets = {
    referenceModes: [],
    loraPresets: [{ key: "detail", label: "Detail", compatibleFamilies: ["sdxl"], enabled: true }],
    imagePresets: { demo: { key: "demo", label: "Demo", loraFamilies: ["sdxl"], supports: [] } },
    recommendedLoraProfiles: [
        { key: "legacy", label: "Legacy", preset: "demo", loras: ["detail"] },
        { key: "disabled", label: "Disabled", preset: "demo", loras: ["detail"], enabled: false },
        { key: "enabled", label: "Enabled", preset: "demo", loras: ["detail"], enabled: true },
    ],
};
assert.deepEqual(recommendedLoraProfiles(profilePresets, "demo").map((profile) => profile.key), ["legacy", "enabled"]);

const productionLike = registry({
    preflight: {
        ...registry().preflight,
        status: "degraded",
        uncheckedLayers: ["workflow_field_compatibility", "smoke", "validated_pairs"],
    },
});
assert.equal(preflightComfyModel(productionLike, "comfy/demo").status, "degraded");
assert.equal(preflightComfyModel(productionLike, "comfy/demo").reasons.some((reason) => reason.includes("尚未验证：smoke")), true);

const optionalControlnetBinding: WorkflowBinding = {
    ...binding,
    workflowBindingId: "comfy.image.demo:controlnet_template",
    workflowFile: "controlnet.json",
    workflowExists: false,
    parseError: "workflow_missing",
    missingNodeTypes: ["ControlNetLoader"],
    requiredRuntimeAssets: [{ assetId: "models/controlnet/missing.safetensors", sha256: "", loader: "ControlNetLoader" }],
    inputBindings: { presetKey: "demo", templateField: "controlnet_template" },
};
const healthyPrimaryWithOptionalFailure: RegisteredModelCapability = {
    ...capability,
    workflowBindingIds: [binding.workflowBindingId, optionalControlnetBinding.workflowBindingId],
    runtime: {
        ...capability.runtime,
        missingNodeTypes: ["ControlNetLoader"],
        missingRuntimeAssets: ["models/controlnet/missing.safetensors"],
    },
};
const optionalFailureDecision = preflightComfyModel(
    registry({
        capabilities: [healthyPrimaryWithOptionalFailure],
        workflowBindings: [binding, optionalControlnetBinding],
        preflight: { ...registry().preflight, status: "degraded", uncheckedLayers: ["validated_pairs"] },
    }),
    "comfy/demo",
);
assert.equal(optionalFailureDecision.status, "degraded");
assert.equal(optionalFailureDecision.reasons.some((reason) => reason.includes("ControlNetLoader") || reason.includes("missing.safetensors")), false);

const missingWorkflow = { ...binding, workflowHash: "", workflowExists: false, parseError: "workflow_missing" as const };
const unavailableCapability: RegisteredModelCapability = {
    ...capability,
    runtime: { ...capability.runtime, workflowReady: false, runtimeReady: false, available: false, smokeStatus: "not_run" },
};
const unavailable = preflightComfyModel(registry({ capabilities: [unavailableCapability], workflowBindings: [missingWorkflow] }), "comfy/demo");
assert.equal(unavailable.status, "unavailable");
assert.equal(unavailable.reasons.some((reason) => reason.includes("WorkflowBinding 文件缺失")), true);
assert.equal(unavailable.reasons.some((reason) => reason.includes("最小 smoke 尚未通过")), true);

const videoCapability: RegisteredModelCapability = {
    ...capability,
    capabilityId: "comfy.video.demo",
    mediaTypes: ["video_generation"],
};
assert.equal(preflightComfyModel(registry({ capabilities: [videoCapability] }), "comfy/demo", "video").capability?.capabilityId, "comfy.video.demo");

const unavailableProbe = { ...binding, runtimeProbeStatus: "unavailable" as const };
const probeDecision = preflightComfyModel(
    registry({ capabilities: [unavailableCapability], workflowBindings: [unavailableProbe] }),
    "comfy/demo",
);
assert.equal(probeDecision.reasons.some((reason) => reason.includes("运行时探针不可用")), true);

for (const loaderVisible of [false, null]) {
    const loaderUnavailable: RegisteredModelCapability = {
        ...capability,
        runtime: { ...capability.runtime, loaderVisible, runtimeReady: false, available: false },
    };
    const loaderDecision = preflightComfyModel(registry({ capabilities: [loaderUnavailable] }), "comfy/demo");
    assert.equal(loaderDecision.status, "unavailable");
    assert.equal(loaderDecision.reasons.some((reason) => reason.includes("Loader 未确认")), true);
}

const img2imgBinding: WorkflowBinding = {
    ...binding,
    workflowBindingId: "comfy.image.demo:img2img_template",
    workflowFile: "demo-img2img.json",
    inputBindings: { presetKey: "demo", templateField: "img2img_template" },
};
const ipadapterBinding: WorkflowBinding = {
    ...binding,
    workflowBindingId: "comfy.image.demo:ipadapter_template",
    workflowFile: "demo-ipadapter.json",
    inputBindings: { presetKey: "demo", templateField: "ipadapter_template" },
};
const outpaintCapability: RegisteredModelCapability = {
    ...capability,
    operations: ["manual", "outpaint"],
    workflowBindingIds: [binding.workflowBindingId, img2imgBinding.workflowBindingId, ipadapterBinding.workflowBindingId],
};
const outpaintRegistry = registry({ capabilities: [outpaintCapability], workflowBindings: [binding, img2imgBinding, ipadapterBinding] });
assert.equal(preflightComfyOutpaint(outpaintRegistry, "comfy/demo", "extend").status, "ready");
assert.equal(preflightComfyOutpaint(outpaintRegistry, "comfy/demo", "full_body").status, "ready");

const legacyOutpaint = preflightComfyOutpaint(
    registry({
        capabilities: [{ ...capability, workflowBindingIds: [binding.workflowBindingId, ipadapterBinding.workflowBindingId] }],
        workflowBindings: [binding, ipadapterBinding],
    }),
    "comfy/demo",
    "extend",
);
assert.equal(legacyOutpaint.status, "degraded", "legacy dynamic canvas_inpaint path must not be presented as fully registered");
assert.equal(legacyOutpaint.reasons.some((reason) => reason.includes("canvas_inpaint")), true);

const missingIpAdapter = preflightComfyOutpaint(registry(), "comfy/demo", "full_body");
assert.equal(missingIpAdapter.status, "unavailable", "full_body requires an IPAdapter workflow binding");
assert.equal(missingIpAdapter.reasons.some((reason) => reason.includes("ipadapter_template")), true);

const brokenImg2imgBinding: WorkflowBinding = {
    ...binding,
    workflowBindingId: "comfy.image.demo:txt2img-broken",
    workflowFile: "broken.json",
    missingNodeTypes: ["MissingNode"],
};
const mixedBindingDecision = preflightComfyOutpaint(
    registry({
        capabilities: [{ ...outpaintCapability, workflowBindingIds: [...outpaintCapability.workflowBindingIds, brokenImg2imgBinding.workflowBindingId] }],
        workflowBindings: [binding, brokenImg2imgBinding, img2imgBinding, ipadapterBinding],
    }),
    "comfy/demo",
    "extend",
);
assert.equal(mixedBindingDecision.status, "degraded", "a broken alternate binding must not block a healthy matching binding");
assert.deepEqual(mixedBindingDecision.workflowBindings.map((item) => item.workflowBindingId), [binding.workflowBindingId]);

const missingIpAdapterAsset = "models/ipadapter/missing.safetensors";
const ipadapterWithMissingAsset: WorkflowBinding = {
    ...ipadapterBinding,
    requiredRuntimeAssets: [{ assetId: missingIpAdapterAsset, sha256: "", loader: "IPAdapterUnifiedLoader" }],
};
const assetMissingCapability: RegisteredModelCapability = {
    ...outpaintCapability,
    runtime: { ...outpaintCapability.runtime, optionalMissingRuntimeAssets: ["  MODELS\\IPADAPTER//Missing.SAFETENSORS (not visible)  "] },
};
const missingAssetDecision = preflightComfyOutpaint(
    registry({ capabilities: [assetMissingCapability], workflowBindings: [binding, img2imgBinding, ipadapterWithMissingAsset] }),
    "comfy/demo",
    "full_body",
);
assert.equal(missingAssetDecision.status, "unavailable", "full_body must reject a binding whose IPAdapter asset is missing");
assert.equal(missingAssetDecision.reasons.some((reason) => reason.includes(missingIpAdapterAsset)), true);

for (const diagnostic of ["ComfyUI 未扫到", "Loader 无枚举"] as const) {
    const chineseSuffixCapability: RegisteredModelCapability = {
        ...outpaintCapability,
        runtime: {
            ...outpaintCapability.runtime,
            optionalMissingRuntimeAssets: [`models/ipadapter/missing.safetensors (${diagnostic})`],
        },
    };
    const chineseSuffixDecision = preflightComfyOutpaint(
        registry({ capabilities: [chineseSuffixCapability], workflowBindings: [binding, img2imgBinding, ipadapterWithMissingAsset] }),
        "comfy/demo",
        "full_body",
    );
    assert.equal(chineseSuffixDecision.status, "unavailable", `Gateway diagnostic "(${diagnostic})" must block the matching binding`);
    assert.equal(chineseSuffixDecision.reasons.some((reason) => reason.includes(missingIpAdapterAsset)), true);
}

const versionedIpAdapterBinding: WorkflowBinding = {
    ...ipadapterBinding,
    requiredRuntimeAssets: [{ assetId: "models/ipadapter/model (v2).safetensors", sha256: "", loader: "IPAdapterUnifiedLoader" }],
};
const otherVersionMissingCapability: RegisteredModelCapability = {
    ...outpaintCapability,
    runtime: { ...outpaintCapability.runtime, optionalMissingRuntimeAssets: ["models/ipadapter/model (v1).safetensors (not visible)"] },
};
const versionedAssetDecision = preflightComfyOutpaint(
    registry({ capabilities: [otherVersionMissingCapability], workflowBindings: [binding, img2imgBinding, versionedIpAdapterBinding] }),
    "comfy/demo",
    "full_body",
);
assert.equal(versionedAssetDecision.status, "ready", "diagnostic suffix stripping must not collapse distinct parenthesized filenames");
assert.equal(versionedAssetDecision.reasons.some((reason) => reason.includes("model (v2).safetensors")), false);

const chineseVersionedCapability: RegisteredModelCapability = {
    ...outpaintCapability,
    runtime: { ...outpaintCapability.runtime, optionalMissingRuntimeAssets: ["models/ipadapter/model (v1).safetensors (ComfyUI 未扫到)"] },
};
const chineseVersionedDecision = preflightComfyOutpaint(
    registry({ capabilities: [chineseVersionedCapability], workflowBindings: [binding, img2imgBinding, versionedIpAdapterBinding] }),
    "comfy/demo",
    "full_body",
);
assert.equal(chineseVersionedDecision.status, "ready", "Chinese diagnostic suffixes must not collapse versioned filenames");

console.log("comfy capability fetch and preflight tests passed");
