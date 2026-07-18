import type { AiConfig, ComfyExtraConfig } from "@/stores/use-config-store";
import type { CanvasExecutionPlan, CanvasExecutionPlanValue, CanvasGenerationSettings, CanvasGenerationValueSource, CanvasImageGenerationType, CanvasNodeMetadata, CanvasOperationProfile, CanvasSourceGenerationRecipe } from "@/types/canvas";

function hasOwn(value: object | undefined, key: PropertyKey) {
    return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function copyLoras(value: string[] | undefined) {
    return Array.isArray(value) ? [...value] : undefined;
}

export function manualNodeSettingsFromMetadata(metadata?: CanvasNodeMetadata): CanvasGenerationSettings {
    if (!metadata) return {};
    return {
        ...(metadata.model ? { model: metadata.model } : {}),
        ...(metadata.promptModel ? { promptModel: metadata.promptModel } : {}),
        ...(metadata.size ? { size: metadata.size } : {}),
        ...(metadata.quality ? { quality: metadata.quality } : {}),
        ...(metadata.count !== undefined ? { count: metadata.count } : {}),
        ...(metadata.comfyReferenceMode ? { referenceMode: metadata.comfyReferenceMode } : {}),
        ...(Array.isArray(metadata.comfyLoras) ? { loras: [...metadata.comfyLoras] } : {}),
        ...(metadata.comfyFaceDetailer !== undefined ? { faceDetailer: metadata.comfyFaceDetailer } : {}),
        ...(metadata.comfyDenoise !== undefined ? { denoise: metadata.comfyDenoise } : {}),
    };
}

export function sourceGenerationRecipeFromMetadata(metadata?: CanvasNodeMetadata): CanvasSourceGenerationRecipe {
    if (!metadata) return {};
    const saved = metadata.sourceGenerationRecipe;
    if (saved) {
        return {
            ...saved,
            ...(Array.isArray(saved.loras) ? { loras: [...saved.loras] } : {}),
            ...(Array.isArray(saved.references) ? { references: [...saved.references] } : {}),
        };
    }
    return {
        ...manualNodeSettingsFromMetadata(metadata),
        ...(metadata.generationType ? { generationType: metadata.generationType } : {}),
        ...(Array.isArray(metadata.references) ? { references: [...metadata.references] } : {}),
    };
}

export function sourceGenerationRecipeFromConfig(type: CanvasImageGenerationType, config: AiConfig, count: number, references: string[]): CanvasSourceGenerationRecipe {
    const extra = config.comfyExtra;
    return {
        generationType: type,
        model: config.model,
        promptModel: config.textModel,
        size: config.size,
        quality: config.quality,
        count,
        references: [...references],
        ...(hasOwn(extra, "reference_mode") ? { referenceMode: extra?.reference_mode || "none" } : {}),
        ...(hasOwn(extra, "lora_keys") ? { loras: copyLoras(extra?.lora_keys) || [] } : {}),
        ...(hasOwn(extra, "face_detailer") ? { faceDetailer: extra?.face_detailer } : {}),
        ...(hasOwn(extra, "denoise") ? { denoise: extra?.denoise } : {}),
    };
}

function planValue(value: CanvasExecutionPlanValue["value"] | undefined, source: CanvasGenerationValueSource) {
    return value === undefined ? undefined : { value, source };
}

export function buildManagedImageExecution(baseConfig: AiConfig, sourceMetadata: CanvasNodeMetadata | undefined, operationProfile: CanvasOperationProfile): { config: AiConfig; plan: CanvasExecutionPlan; recipe: CanvasSourceGenerationRecipe } {
    const recipe = sourceGenerationRecipeFromMetadata(sourceMetadata);
    const model = recipe.model || sourceMetadata?.model || baseConfig.imageModel || baseConfig.model;
    const promptModel = recipe.promptModel || sourceMetadata?.promptModel || baseConfig.textModel;
    const size = operationProfile.targetWidth && operationProfile.targetHeight ? `${operationProfile.targetWidth}x${operationProfile.targetHeight}` : recipe.size || sourceMetadata?.size || baseConfig.size;
    const quality = recipe.quality || sourceMetadata?.quality || baseConfig.quality;
    const isFullBodyOutpaint = operationProfile.kind === "outpaint" && operationProfile.outpaintMode === "full_body";
    const isMaskedOutpaint = operationProfile.kind === "outpaint" && operationProfile.outpaintMode !== "full_body";
    // full_body：soft IPAdapter 锁身份气质 + EmptyLatent 保构图；extend/inpaint：蒙版路径强制 none
    const referenceMode = isFullBodyOutpaint
        ? "ipadapter"
        : operationProfile.kind === "inpaint" || isMaskedOutpaint
          ? "none"
          : recipe.referenceMode;
    const faceDetailer = operationProfile.faceProtection ? false : recipe.faceDetailer;
    // full_body 关闭 latent denoise，避免近景参考被当成 img2img latent 钉死构图
    const denoise = isFullBodyOutpaint ? false : (operationProfile.denoise ?? recipe.denoise);
    const loras = copyLoras(recipe.loras);
    const comfyExtra: ComfyExtraConfig = {
        ...(referenceMode && referenceMode !== "none" ? { reference_mode: referenceMode } : {}),
        ...(loras !== undefined ? { lora_keys: loras } : {}),
        ...(faceDetailer !== undefined ? { face_detailer: faceDetailer } : {}),
        ...(denoise !== undefined ? { denoise } : {}),
        ...(isMaskedOutpaint && operationProfile.seamOverlapPixels !== undefined ? { seam_feather: operationProfile.seamOverlapPixels } : {}),
        ...(isMaskedOutpaint && operationProfile.direction ? { outpaint_direction: operationProfile.direction } : {}),
        prompt_optimize: false,
    };
    const config: AiConfig = {
        ...baseConfig,
        model,
        textModel: promptModel,
        size,
        quality,
        count: "1",
        comfyExtra,
    };
    const sourceFor = (value: unknown, fallback: CanvasGenerationValueSource = "source_recipe") => (value !== undefined ? fallback : "preset_default");
    const values: CanvasExecutionPlan["values"] = {
        model: planValue(model, sourceFor(recipe.model)),
        promptModel: planValue(promptModel, sourceFor(recipe.promptModel)),
        size: planValue(size, operationProfile.targetWidth && operationProfile.targetHeight ? "operation_profile" : sourceFor(recipe.size)),
        quality: planValue(quality, sourceFor(recipe.quality)),
        count: planValue(1, "operation_profile"),
        referenceMode: planValue(referenceMode || "none", operationProfile.kind === "inpaint" || operationProfile.kind === "outpaint" ? "operation_profile" : sourceFor(recipe.referenceMode)),
        loras: planValue(loras, recipe.loras !== undefined ? "source_recipe" : "preset_default"),
        faceDetailer: planValue(faceDetailer ?? false, operationProfile.faceProtection ? "operation_profile" : sourceFor(recipe.faceDetailer)),
        denoise: planValue(denoise ?? null, isFullBodyOutpaint || operationProfile.denoise !== undefined ? "operation_profile" : sourceFor(recipe.denoise)),
    };
    return {
        config,
        recipe,
        plan: {
            operation: operationProfile.kind,
            managed: operationProfile.managed,
            createdAt: new Date().toISOString(),
            values,
            protections: [
                ...(isFullBodyOutpaint ? ["主图 soft IPAdapter 气质参考 + EmptyLatent 重生成（不保证像素锁脸）"] : []),
                ...(operationProfile.originalPixelLock && !isFullBodyOutpaint ? ["原图非接缝区域像素锁定"] : []),
                ...(isMaskedOutpaint ? ["蒙版局部重绘 + 像素回贴"] : []),
                ...(operationProfile.faceProtection ? ["关闭全图 FaceDetailer"] : []),
                ...(operationProfile.inheritSourceRecipe ? ["继承源图模型与 LoRA 配方"] : []),
            ],
        },
    };
}
