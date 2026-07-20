import assert from "node:assert/strict";

import { parseImageResponse } from "../src/services/api/image.ts";
import type { GenerationExecutionReceipt } from "../src/types/generation.ts";

const receipt: GenerationExecutionReceipt = {
    schemaVersion: "2",
    receiptId: "prompt-final",
    planned: {
        baseCapabilityId: "comfy.image.wai",
        baseModelId: "illustrious-xl-v0.1",
        requestedReferenceMode: "inpaint",
        workflowBindingId: "comfy.image.wai:txt2img_template",
        templateField: "txt2img_template",
    },
    primaryStageId: "primary",
    finalStageId: "primary",
    stages: [{
        stageId: "primary",
        stageKind: "primary",
        taskResult: "succeeded",
        promptId: "prompt-final",
        baseCapabilityId: "comfy.image.wai",
        workflowBindingId: "comfy.image.wai:txt2img_template",
        workflowHash: "workflow-hash",
        workflowFile: "wai.json",
        templateField: "txt2img_template",
        effectiveReferenceMode: "inpaint",
        adapterKind: null,
        mutators: ["canvas_inpaint"],
        fallback: {
            used: false,
            requestedReferenceMode: "inpaint",
            effectiveReferenceMode: "inpaint",
        },
        assetVersions: [{ assetId: "models/checkpoints/wai.safetensors", sha256: "model-hash", hashStatus: "registered" }],
        actualLoras: [{
            file: "detail.safetensors",
            nodeId: "20",
            loaderClass: "LoraLoader",
            source: "gateway_dynamic",
            strengthModel: 0.8,
            strengthClip: 0.7,
        }],
        loraEvidence: { status: "complete", opaqueSources: [] },
        comfyExecutionSeconds: 3.5,
        error: null,
    }],
    actual: {
        stageId: "primary",
        stageKind: "primary",
        taskResult: "succeeded",
        promptId: "prompt-final",
        baseCapabilityId: "comfy.image.wai",
        workflowBindingId: "comfy.image.wai:txt2img_template",
        workflowHash: "workflow-hash",
        workflowFile: "wai.json",
        templateField: "txt2img_template",
        effectiveReferenceMode: "inpaint",
        adapterKind: null,
        mutators: ["canvas_inpaint"],
        fallback: {
            used: false,
            requestedReferenceMode: "inpaint",
            effectiveReferenceMode: "inpaint",
        },
        assetVersions: [{ assetId: "models/checkpoints/wai.safetensors", sha256: "model-hash", hashStatus: "registered" }],
        actualLoras: [{
            file: "detail.safetensors",
            nodeId: "20",
            loaderClass: "LoraLoader",
            source: "gateway_dynamic",
            strengthModel: 0.8,
            strengthClip: 0.7,
            stageIds: ["primary"],
        }],
        loraEvidence: { status: "complete", opaqueSources: [] },
        comfyExecutionSeconds: 3.5,
        totalComfyExecutionSeconds: 3.5,
        error: null,
    },
};

const parsed = parseImageResponse({
    data: [{ b64_json: "AAAA" }, { b64_json: "BBBB" }],
    execution_receipt: receipt,
});
assert.equal(parsed.images.length, 2);
assert.strictEqual(parsed.images[0].executionReceipt, receipt);
assert.strictEqual(parsed.images[1].executionReceipt, receipt);
assert.equal(parsed.images[0].executionReceipt?.actual.assetVersions[0].hashStatus, "registered");
assert.equal(parsed.images[0].executionReceipt?.actual.assetVersions[0].assetId, "models/checkpoints/wai.safetensors");
assert.equal(parsed.images[0].executionReceipt?.actual.loraEvidence.status, "complete");
assert.equal(parsed.images[0].executionReceipt?.actual.actualLoras[0].stageIds?.[0], "primary");

const presetFallback = structuredClone(receipt) as GenerationExecutionReceipt;
presetFallback.planned.baseCapabilityId = "comfy.image.not-a-real-preset";
presetFallback.stages[0].baseCapabilityId = "comfy.image.wai";
presetFallback.stages[0].fallback = {
    used: true,
    requestedReferenceMode: "inpaint",
    effectiveReferenceMode: "inpaint",
    preset: {
        from: "not-a-real-preset",
        to: "wai",
        reason: "requested_preset_unavailable",
    },
};
presetFallback.actual.baseCapabilityId = "comfy.image.wai";
presetFallback.actual.fallback = structuredClone(presetFallback.stages[0].fallback);
assert.strictEqual(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: presetFallback,
}).images[0].executionReceipt, presetFallback);

const missingPresetFallback = structuredClone(presetFallback) as GenerationExecutionReceipt;
missingPresetFallback.stages[0].fallback.preset = null;
missingPresetFallback.actual.fallback.preset = null;
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: missingPresetFallback,
}).images[0].executionReceipt, undefined);

const legacy = structuredClone(receipt) as unknown as Record<string, unknown>;
legacy.schemaVersion = "1";
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: legacy as unknown as GenerationExecutionReceipt,
}).images[0].executionReceipt, undefined);

const invalid = parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: { schemaVersion: "1", receiptId: "broken" } as unknown as GenerationExecutionReceipt,
});
assert.equal(invalid.images[0].executionReceipt, undefined);

const malformedStage = structuredClone(receipt) as GenerationExecutionReceipt;
(malformedStage.stages[0] as unknown as Record<string, unknown>).taskResult = "pending";
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: malformedStage,
}).images[0].executionReceipt, undefined);

const malformedAssetVersion = structuredClone(receipt) as GenerationExecutionReceipt;
(malformedAssetVersion.actual.assetVersions[0] as unknown as Record<string, unknown>).hashStatus = "unknown";
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: malformedAssetVersion,
}).images[0].executionReceipt, undefined);

const emptyStages = structuredClone(receipt) as GenerationExecutionReceipt;
emptyStages.stages = [];
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: emptyStages,
}).images[0].executionReceipt, undefined);

const missingTotal = structuredClone(receipt) as GenerationExecutionReceipt;
delete (missingTotal.actual as unknown as Record<string, unknown>).totalComfyExecutionSeconds;
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: missingTotal,
}).images[0].executionReceipt, undefined);

const malformedLoraEvidence = structuredClone(receipt) as GenerationExecutionReceipt;
(malformedLoraEvidence.actual.loraEvidence as unknown as Record<string, unknown>).status = "verified";
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: malformedLoraEvidence,
}).images[0].executionReceipt, undefined);

const malformedActualLora = structuredClone(receipt) as GenerationExecutionReceipt;
(malformedActualLora.actual.actualLoras[0] as unknown as Record<string, unknown>).strengthModel = "0.8";
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: malformedActualLora,
}).images[0].executionReceipt, undefined);

const fakeComplete = structuredClone(receipt) as GenerationExecutionReceipt;
fakeComplete.stages[0].loraEvidence = {
    status: "unknown",
    opaqueSources: [{ nodeId: null, loaderClass: null, reason: "final_workflow_not_observed" }],
};
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: fakeComplete,
}).images[0].executionReceipt, undefined);

const invalidFinalStage = structuredClone(receipt) as GenerationExecutionReceipt;
invalidFinalStage.finalStageId = "missing-stage";
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: invalidFinalStage,
}).images[0].executionReceipt, undefined);

const invalidStageIds = structuredClone(receipt) as GenerationExecutionReceipt;
invalidStageIds.actual.actualLoras[0].stageIds = ["missing-stage"];
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: invalidStageIds,
}).images[0].executionReceipt, undefined);

const optionalFailedStage = structuredClone(receipt) as GenerationExecutionReceipt;
optionalFailedStage.stages.push({
    ...structuredClone(optionalFailedStage.stages[0]),
    stageId: "face-refine",
    stageKind: "refinement",
    taskResult: "failed",
    promptId: "prompt-refine",
    actualLoras: [],
    loraEvidence: { status: "complete", opaqueSources: [] },
    error: "refine failed",
});
optionalFailedStage.actual.totalComfyExecutionSeconds = 7;
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: optionalFailedStage,
}).images[0].executionReceipt?.finalStageId, "primary");

const inconsistentFinalStage = structuredClone(receipt) as GenerationExecutionReceipt;
inconsistentFinalStage.actual.taskResult = "failed";
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: inconsistentFinalStage,
}).images[0].executionReceipt, undefined);

const malformedAssetId = structuredClone(receipt) as GenerationExecutionReceipt;
(malformedAssetId.actual.assetVersions[0] as unknown as Record<string, unknown>).assetId = 42;
assert.equal(parseImageResponse({
    data: [{ b64_json: "AAAA" }],
    execution_receipt: malformedAssetId,
}).images[0].executionReceipt, undefined);

console.log("image execution receipt tests passed");
