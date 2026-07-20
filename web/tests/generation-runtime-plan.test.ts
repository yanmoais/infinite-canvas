import assert from "node:assert/strict";

import {
    buildComfyExecutionPlan,
    cloneComfyExecutionPlan,
    createImageContentVersion,
    replayComfyExecutionPlan,
    resolveImageReferenceBindings,
    revalidateReplayedComfyExecutionPlan,
} from "../src/lib/canvas/generation-runtime-plan.ts";
import { CanvasNodeType } from "../src/types/canvas.ts";
import type { CapabilityPreflightDecision } from "../src/types/generation.ts";

const nodes = [
    {
        id: "identity",
        type: CanvasNodeType.Image,
        title: "identity",
        position: { x: 0, y: 0 },
        width: 320,
        height: 320,
        metadata: { content: "data:image/png;base64,identity", revision: 3, contentHash: "identity-hash" },
    },
    {
        id: "style",
        type: CanvasNodeType.Image,
        title: "style",
        position: { x: 0, y: 0 },
        width: 320,
        height: 320,
        metadata: { content: "data:image/png;base64,style", revision: 2, contentHash: "style-hash" },
    },
];
const references = [
    { id: "identity", name: "identity.png", type: "image/png", dataUrl: "data:image/png;base64,a" },
    { id: "style", name: "style.png", type: "image/png", dataUrl: "data:image/png;base64,b" },
];
const decision: CapabilityPreflightDecision = {
    status: "degraded",
    reasons: ["尚未验证：validated_pairs"],
    capability: {
        capabilityId: "comfy.image.demo",
        label: "Demo",
        publisher: "demo",
        sourceRepo: "demo",
        sha256: "model-hash",
        registryFingerprint: "registry-hash",
        architecture: "sdxl",
        operations: ["manual"],
        mediaTypes: ["image_edit"],
        validatedPairs: [],
        safetyMode: null,
        qualityTier: null,
        productionDefault: false,
        workflowBindingIds: ["binding-invalid", "binding-valid"],
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
    },
    workflowBindings: [
        {
            workflowBindingId: "binding-invalid",
            capabilityId: "comfy.image.demo",
            workflowHash: "",
            workflowFile: "missing.json",
            workflowExists: false,
            parseError: "workflow_missing",
            runtimeProbeStatus: "unavailable",
            requiredNodeTypes: [],
            missingNodeTypes: [],
            requiredRuntimeAssets: [],
            inputCompatibility: { status: "unavailable", issues: [] },
            inputBindings: {},
        },
        {
            workflowBindingId: "binding-valid",
            capabilityId: "comfy.image.demo",
            workflowHash: "workflow-hash",
            workflowFile: "demo.json",
            workflowExists: true,
            parseError: "",
            runtimeProbeStatus: "checked",
            requiredNodeTypes: ["CheckpointLoaderSimple"],
            missingNodeTypes: [],
            requiredRuntimeAssets: [{ assetId: "models/checkpoints/demo.safetensors", sha256: "asset-hash", loader: "CheckpointLoaderSimple" }],
            inputCompatibility: { status: "compatible", issues: [] },
            inputBindings: { templateField: "img2img_template" },
        },
    ],
};

const bindings = resolveImageReferenceBindings(references, nodes, "identity");
assert.deepEqual(bindings.map((binding) => binding.role), ["body_identity", "style"]);
assert.equal(bindings[0].revision, 3);
assert.equal(bindings[1].contentHash, "style-hash");

const nodesWithEmptySource = [
    ...nodes,
    {
        id: "empty-generation",
        type: CanvasNodeType.Image,
        title: "empty generation",
        position: { x: 0, y: 0 },
        width: 320,
        height: 320,
        metadata: { content: "", revision: 9, contentHash: "empty-generation-hash" },
    },
];
const expectedUpstreamReferences = [
    { nodeId: "identity", revision: 3, contentHash: "identity-hash" },
    { nodeId: "style", revision: 2, contentHash: "style-hash" },
];
const emptySourceBindings = resolveImageReferenceBindings(references, nodesWithEmptySource, "empty-generation");
assert.deepEqual(
    emptySourceBindings.map(({ nodeId, revision, contentHash }) => ({ nodeId, revision, contentHash })),
    expectedUpstreamReferences,
);

const plan = buildComfyExecutionPlan({
    model: "comfy/demo",
    prompt: "demo prompt",
    mediaType: "image_edit",
    operation: "manual",
    count: 2,
    references,
    nodes,
    sourceNodeId: "identity",
    referenceMode: "img2img",
    decision,
});
assert.equal(plan.workflowBindingId, "binding-valid");
assert.equal(plan.runtimeSnapshot?.workflowHash, "workflow-hash");
assert.equal(plan.runtimeSnapshot?.runtimeAssetHashes?.["models/checkpoints/demo.safetensors"], "asset-hash");
assert.equal(plan.capabilityDecisions[0].status, "degraded");
assert.match(plan.capabilityDecisions[0].reason || "", /validated_pairs/);
assert.equal(plan.resolvedReferences[0].nodeId, "identity");
assert.equal(plan.values.model.value, "comfy/demo");
assert.equal(plan.values.requestCount.value, 1);
assert.equal(plan.values.batchCount.value, 2);
assert.equal(plan.runtimeSnapshot?.runtimeAssetHashes?.["capability:comfy.image.demo"], "model-hash");

const emptySourcePlan = buildComfyExecutionPlan({
    model: "comfy/demo",
    prompt: "generate from upstream image",
    mediaType: "image_edit",
    operation: "manual",
    count: 1,
    references,
    nodes: nodesWithEmptySource,
    sourceNodeId: "empty-generation",
    referenceMode: "img2img",
    decision,
});
assert.deepEqual(
    emptySourcePlan.resolvedReferences.map(({ nodeId, revision, contentHash }) => ({ nodeId, revision, contentHash })),
    expectedUpstreamReferences,
);

const ipadapterBinding = {
    ...decision.workflowBindings[1],
    workflowBindingId: "binding-ipadapter",
    workflowHash: "ipadapter-workflow-hash",
    requiredRuntimeAssets: [{ assetId: "models/ipadapter/demo.safetensors", sha256: "ipadapter-asset-hash", loader: "IPAdapterUnifiedLoader" }],
    inputCompatibility: { status: "compatible" as const, issues: [] },
    inputBindings: { templateField: "ipadapter_template" },
};
const ipadapterPlan = buildComfyExecutionPlan({
    model: "comfy/demo",
    prompt: "full body",
    mediaType: "image_edit",
    operation: "outpaint",
    count: 1,
    references: [{ ...references[0], id: "identity-outpaint-identity" }, references[1]],
    nodes,
    sourceNodeId: "identity",
    referenceMode: "ipadapter",
    decision: { ...decision, status: "ready", reasons: [], workflowBindings: [ipadapterBinding] },
});
assert.equal(ipadapterPlan.workflowBindingId, "binding-ipadapter");
assert.equal(ipadapterPlan.runtimeSnapshot?.workflowHash, "ipadapter-workflow-hash");
assert.equal(ipadapterPlan.runtimeSnapshot?.runtimeAssetHashes?.["models/ipadapter/demo.safetensors"], "ipadapter-asset-hash");
const expectedOutpaintReferences = [
    { nodeId: "identity", revision: 3, contentHash: "identity-hash" },
    { nodeId: "style", revision: 2, contentHash: "style-hash" },
];
assert.deepEqual(
    ipadapterPlan.resolvedReferences.map(({ nodeId, revision, contentHash }) => ({ nodeId, revision, contentHash })),
    expectedOutpaintReferences,
);

const incompatibleIpAdapterPlan = buildComfyExecutionPlan({
    model: "comfy/demo",
    prompt: "full body",
    mediaType: "image_edit",
    operation: "outpaint",
    count: 1,
    references: references.slice(0, 1),
    nodes,
    sourceNodeId: "identity",
    referenceMode: "ipadapter",
    decision: {
        ...decision,
        status: "ready",
        reasons: [],
        workflowBindings: [{
            ...ipadapterBinding,
            inputCompatibility: {
                status: "incompatible",
                issues: [{ nodeId: "1", classType: "IPAdapterModelLoader", unknownFields: [], missingRequiredFields: ["ipadapter"] }],
            },
        }],
    },
});
assert.equal(incompatibleIpAdapterPlan.workflowBindingId, undefined, "input-incompatible IPAdapter binding must not be recorded");
assert.match(incompatibleIpAdapterPlan.capabilityDecisions[0].reason || "", /不可执行/);

const missingAssetIpAdapterPlan = buildComfyExecutionPlan({
    model: "comfy/demo",
    prompt: "full body",
    mediaType: "image_edit",
    operation: "outpaint",
    count: 1,
    references: references.slice(0, 1),
    nodes,
    sourceNodeId: "identity",
    referenceMode: "ipadapter",
    decision: {
        ...decision,
        status: "ready",
        reasons: [],
        capability: {
            ...decision.capability!,
            runtime: {
                ...decision.capability!.runtime,
                optionalMissingRuntimeAssets: ["models/ipadapter/demo.safetensors (ComfyUI 未扫到)"],
            },
        },
        workflowBindings: [ipadapterBinding],
    },
});
assert.equal(missingAssetIpAdapterPlan.workflowBindingId, undefined, "IPAdapter binding with missing runtime asset must not be recorded");
assert.match(missingAssetIpAdapterPlan.capabilityDecisions[0].reason || "", /不可执行/);

const extendPlan = buildComfyExecutionPlan({
    model: "comfy/demo",
    prompt: "extend image",
    mediaType: "image_edit",
    operation: "outpaint",
    count: 1,
    references: [{ ...references[0], id: "identity-outpaint-base" }, references[1]],
    nodes,
    sourceNodeId: "identity",
    referenceMode: "none",
    decision,
});
assert.deepEqual(
    extendPlan.resolvedReferences.map(({ nodeId, revision, contentHash }) => ({ nodeId, revision, contentHash })),
    expectedOutpaintReferences,
);

const faceIdPlan = buildComfyExecutionPlan({
    model: "comfy/demo",
    prompt: "change pose",
    mediaType: "image_edit",
    operation: "pose_change",
    count: 1,
    references: references.slice(0, 1),
    nodes,
    sourceNodeId: "identity",
    referenceMode: "faceid",
    decision: { ...decision, status: "ready", reasons: [] },
});
assert.equal(faceIdPlan.workflowBindingId, undefined, "faceid must not be mislabeled as txt2img/img2img before Registry exposes its binding");
assert.match(faceIdPlan.capabilityDecisions[0].reason || "", /不伪造实际工作流/);

const cloned = cloneComfyExecutionPlan(plan);
assert.notEqual(cloned, plan);
assert.deepEqual(cloned, plan);
assert.notEqual(cloned?.compiledPrompt.blocks, plan.compiledPrompt.blocks);
assert.notEqual(cloned?.compiledPrompt.warnings, plan.compiledPrompt.warnings);
assert.notEqual(cloned?.compiledPrompt.removed, plan.compiledPrompt.removed);

const replay = replayComfyExecutionPlan(plan);
assert.equal(replay?.operation, "exact_replay");
assert.equal(replay?.values.model.source, "exact_replay");
assert.notEqual(replay?.planId, plan.planId);

const revalidatedReplay = revalidateReplayedComfyExecutionPlan(plan, {
    ...decision,
    status: "degraded",
    reasons: ["当前运行时降级"],
});
assert.equal(revalidatedReplay?.values.model.source, "exact_replay");
assert.equal(revalidatedReplay?.workflowBindingId, plan.workflowBindingId);
assert.equal(revalidatedReplay?.runtimeSnapshot?.workflowHash, plan.runtimeSnapshot?.workflowHash);
assert.deepEqual(revalidatedReplay?.runtimeSnapshot?.runtimeAssetHashes, plan.runtimeSnapshot?.runtimeAssetHashes);
assert.equal(revalidatedReplay?.compiledFromHash, plan.compiledFromHash);
assert.match(revalidatedReplay?.capabilityDecisions[0].reason || "", /当前运行时降级/);

const firstImageVersion = createImageContentVersion({ storageKey: "image:first", bytes: 1024, width: 512, height: 768 });
const replacedImageVersion = createImageContentVersion({ storageKey: "image:second", bytes: 2048, width: 512, height: 768 }, firstImageVersion.revision);
assert.equal(firstImageVersion.revision, 1);
assert.equal(replacedImageVersion.revision, 2);
assert.notEqual(firstImageVersion.contentHash, replacedImageVersion.contentHash);

console.log("generation runtime plan tests passed");
