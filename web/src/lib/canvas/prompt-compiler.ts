import { composePromptFromBaseAndTags } from "@/lib/canvas/smart-compose-prompt";
import type { CompiledPrompt, CompiledPromptBlock, GenerationIntent, PromptBlockSource } from "@/types/generation";

const labels = {
    shotSize: {
        extreme_close_up: "extreme close-up",
        close_up: "close-up",
        medium_close_up: "medium close-up",
        medium: "medium shot",
        medium_full: "medium full shot",
        full: "full body shot",
        wide: "wide shot",
    },
    subjectPlacement: {
        center: "centered composition",
        left_third: "subject on the left third",
        right_third: "subject on the right third",
        symmetry: "symmetrical composition",
    },
    headroom: { tight: "tight headroom", normal: "natural headroom", open: "open headroom" },
    cameraAngle: { eye_level: "eye-level camera", high: "high-angle camera", low: "low-angle camera", top_down: "top-down camera", dutch: "dutch angle" },
    cameraView: { front: "front view", three_quarter: "three-quarter view", profile: "profile view", back: "back view" },
    lensFeel: { wide: "wide-angle lens", normal: "normal lens", portrait: "portrait lens", telephoto: "telephoto lens" },
    cameraDistance: { near: "near camera distance", medium: "medium camera distance", far: "far camera distance" },
    keyDirection: { front: "front key light", left: "key light from camera left", right: "key light from camera right", back: "back key light", top: "top key light" },
    softness: { hard: "hard light", balanced: "balanced light", soft: "soft light" },
    colorTemperature: { cool: "cool color temperature", neutral: "neutral color temperature", warm: "warm color temperature", mixed: "mixed color temperatures" },
    contrast: { low: "low contrast lighting", medium: "medium contrast lighting", high: "high contrast lighting" },
    timeOfDay: { dawn: "dawn light", day: "daylight", golden_hour: "golden hour", night: "night lighting", interior: "interior lighting" },
} as const;

export function compileGenerationPrompt(intent: GenerationIntent): CompiledPrompt {
    const blocks: CompiledPromptBlock[] = [];
    const add = (source: PromptBlockSource, values: Array<string | undefined>) => {
        const text = values.filter(Boolean).join(", ");
        if (text) blocks.push({ source, text });
    };
    const composition = intent.composition;

    add(
        "protection",
        (intent.protections || []).map((rule) => rule.description || `${rule.mode.replaceAll("_", " ")} ${rule.target.replaceAll("_", " ")}`),
    );
    add(
        "identity",
        (intent.references || [])
            .filter((reference) => ["face_identity", "body_identity", "hairstyle", "outfit"].includes(reference.role))
            .map((reference) => `preserve ${reference.role.replaceAll("_", " ")}`),
    );
    add("pose", [
        composition?.pose?.description,
        composition?.pose?.action,
        composition?.pose?.bodyOrientation ? `${composition.pose.bodyOrientation.replaceAll("_", " ")} body orientation` : undefined,
        composition?.pose?.balance ? `${composition.pose.balance} body balance` : undefined,
    ]);
    add("framing", [
        composition?.framing?.shotSize ? labels.shotSize[composition.framing.shotSize] : undefined,
        composition?.framing?.subjectPlacement ? labels.subjectPlacement[composition.framing.subjectPlacement] : undefined,
        composition?.framing?.headroom ? labels.headroom[composition.framing.headroom] : undefined,
        composition?.framing?.leadRoom && composition.framing.leadRoom !== "none" ? `lead room on the ${composition.framing.leadRoom}` : undefined,
        ...(composition?.framing?.forbidCrop || []).map((part) => `do not crop ${part}`),
    ]);
    add("camera", [
        composition?.camera?.angle ? labels.cameraAngle[composition.camera.angle] : undefined,
        composition?.camera?.view ? labels.cameraView[composition.camera.view] : undefined,
        composition?.camera?.lensFeel ? labels.lensFeel[composition.camera.lensFeel] : undefined,
        composition?.camera?.cameraDistance ? labels.cameraDistance[composition.camera.cameraDistance] : undefined,
    ]);
    add("scene", [
        composition?.scene?.description,
        composition?.scene?.location,
        composition?.scene?.environment,
        ...(composition?.scene?.foreground || []).map((item) => `${item} in foreground`),
        ...(composition?.scene?.background || []).map((item) => `${item} in background`),
        ...(composition?.scene?.spatialRelations || []),
    ]);
    add("lighting", [
        composition?.lighting?.keyDirection ? labels.keyDirection[composition.lighting.keyDirection] : undefined,
        composition?.lighting?.softness ? labels.softness[composition.lighting.softness] : undefined,
        composition?.lighting?.colorTemperature ? labels.colorTemperature[composition.lighting.colorTemperature] : undefined,
        composition?.lighting?.contrast ? labels.contrast[composition.lighting.contrast] : undefined,
        composition?.lighting?.timeOfDay ? labels.timeOfDay[composition.lighting.timeOfDay] : undefined,
        ...(composition?.lighting?.practicalLights || []).map((item) => `visible practical light: ${item}`),
    ]);
    add("operation", [operationInstruction(intent.operation)]);
    add("user_prompt", [intent.userPrompt]);

    const result = composePromptFromBaseAndTags(
        "",
        blocks.map((block) => block.text),
        true,
        { hasReferenceImages: Boolean(intent.references?.length) },
    );
    return {
        positive: result.prompt,
        negative: intent.negativePrompt?.trim() || "",
        blocks,
        warnings: result.notes,
        removed: result.removed,
    };
}

function operationInstruction(operation: GenerationIntent["operation"]) {
    if (operation === "inpaint") return "edit only the masked region";
    if (operation === "outpaint") return "extend the scene with seamless continuity";
    if (operation === "pose_change") return "change the pose while preserving the requested identity";
    if (operation === "layout_generation") return "follow the requested layout and spatial relationships";
    if (operation === "exact_replay") return "replay the stored execution settings exactly";
    return undefined;
}
