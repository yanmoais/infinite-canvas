import assert from "node:assert/strict";

import { buildManagedImageExecution, sourceGenerationRecipeFromConfig, sourceGenerationRecipeFromMetadata } from "../src/lib/canvas/generation-plan.ts";

const baseConfig = {
    model: "comfy/wai",
    imageModel: "comfy/wai",
    textModel: "gpt-text",
    size: "1152x1536",
    quality: "auto",
    comfyExtra: { lora_keys: ["should-not-leak"] },
} as never;

const explicitEmpty = sourceGenerationRecipeFromMetadata({
    sourceGenerationRecipe: {
        generationType: "generation",
        model: "comfy/wai",
        promptModel: "gpt-text",
        size: "1152x1536",
        quality: "auto",
        loras: [],
        faceDetailer: true,
    },
});
assert.deepEqual(explicitEmpty.loras, [], "explicit empty LoRA must remain distinct from unknown");

const execution = buildManagedImageExecution(
    baseConfig,
    { sourceGenerationRecipe: explicitEmpty },
    {
        kind: "outpaint",
        managed: true,
        originalPixelLock: true,
        inheritSourceRecipe: true,
        faceProtection: true,
        denoise: 0.68,
        targetWidth: 1152,
        targetHeight: 2048,
    },
);
assert.deepEqual(execution.config.comfyExtra?.lora_keys, [], "outpaint must not inject default LoRAs into an explicit-empty source recipe");
assert.equal(execution.config.comfyExtra?.face_detailer, false);
assert.equal(execution.config.comfyExtra?.denoise, 0.68);
assert.equal(execution.config.size, "1152x2048");
assert.equal(execution.plan.values.loras?.source, "source_recipe");
assert.equal(execution.plan.values.denoise?.source, "operation_profile");

const persisted = sourceGenerationRecipeFromConfig(
    "edit",
    {
        ...baseConfig,
        comfyExtra: { lora_keys: [], face_detailer: false, denoise: 0.68 },
    } as never,
    1,
    ["image:base"],
);
assert.deepEqual(persisted.loras, []);
assert.equal(persisted.faceDetailer, false);
assert.equal(persisted.denoise, 0.68);

const fullBodyExecution = buildManagedImageExecution(
    baseConfig,
    { sourceGenerationRecipe: explicitEmpty },
    {
        kind: "outpaint",
        managed: true,
        outpaintMode: "full_body",
        originalPixelLock: false,
        inheritSourceRecipe: true,
        faceProtection: true,
        targetWidth: 1024,
        targetHeight: 1792,
    },
);
assert.equal(fullBodyExecution.config.comfyExtra?.reference_mode, "ipadapter", "full_body main pass uses soft IPAdapter; latent denoise stays off");
assert.equal(fullBodyExecution.config.comfyExtra?.face_detailer, false);
assert.equal(fullBodyExecution.config.comfyExtra?.denoise, false, "full_body must disable latent denoise");
assert.equal(fullBodyExecution.config.size, "1024x1792");
assert.ok(fullBodyExecution.plan.protections?.some((item) => item.includes("不保证像素锁脸") || item.includes("EmptyLatent")));

console.log("generation plan tests passed");
