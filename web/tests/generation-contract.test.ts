import assert from "node:assert/strict";

import { compileGenerationPrompt } from "../src/lib/canvas/prompt-compiler.ts";
import type { GenerationIntent, MediaGenerationType } from "../src/types/generation.ts";

const mediaTypes: MediaGenerationType[] = ["image_generation", "image_edit", "video_generation", "audio_generation"];
assert.equal(mediaTypes.includes("image_edit"), true);

const intent: GenerationIntent = {
    schemaVersion: "1",
    mediaType: "image_edit",
    operation: "outpaint",
    userPrompt: "same woman in a quiet courtyard",
    composition: {
        framing: { shotSize: "full", headroom: "open", forbidCrop: ["head", "hands", "feet"] },
        camera: { angle: "eye_level", lensFeel: "portrait" },
        scene: { background: ["stone wall", "green plants"] },
        lighting: { keyDirection: "left", softness: "soft", colorTemperature: "warm" },
    },
    references: [{ bindingId: "face-1", nodeId: "image-1", role: "face_identity", required: true }],
};

const compiled = compileGenerationPrompt(intent);
assert.match(compiled.positive, /full body shot/i);
assert.match(compiled.positive, /do not crop feet/i);
assert.match(compiled.positive, /key light from camera left/i);
assert.equal(compiled.blocks.some((block) => block.source === "scene"), true);
assert.equal("storyId" in (intent.contextTrace || {}), false, "independent operations must not require Story context");

console.log("generation contract tests passed");
