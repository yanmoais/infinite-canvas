export type CanvasOperationKind =
    | "manual"
    | "inpaint"
    | "outpaint"
    | "pose_change"
    | "character_atelier"
    | "layout_generation"
    | "exact_replay";

export type MediaGenerationType = "image_generation" | "image_edit" | "video_generation" | "audio_generation";

export type GenerationValueSource =
    | "user_override"
    | "shot_override"
    | "scene_context"
    | "character_context"
    | "creative_spec"
    | "manual_node"
    | "source_recipe"
    | "operation_profile"
    | "preset_default"
    | "exact_replay";

export type ReferenceRole =
    | "face_identity"
    | "body_identity"
    | "hairstyle"
    | "outfit"
    | "pose"
    | "depth"
    | "layout"
    | "scene"
    | "style"
    | "lighting"
    | "first_frame"
    | "last_frame";

export type ReferenceBinding = {
    bindingId: string;
    nodeId: string;
    role: ReferenceRole;
    subjectId?: string;
    strength?: number;
    revision?: number;
    contentHash?: string;
    regionMaskNodeId?: string;
    required?: boolean;
    scope?: "operation" | "character" | "scene" | "shot" | "story";
};

export type PoseIntent = {
    description?: string;
    action?: string;
    bodyOrientation?: "front" | "three_quarter" | "profile" | "back";
    balance?: "stable" | "dynamic";
    poseAssetId?: string;
    poseAssetRevision?: number;
    poseAssetContentHash?: string;
};

export type CameraIntent = {
    angle?: "eye_level" | "high" | "low" | "top_down" | "dutch";
    view?: "front" | "three_quarter" | "profile" | "back";
    lensFeel?: "wide" | "normal" | "portrait" | "telephoto";
    cameraDistance?: "near" | "medium" | "far";
    eyeLineTarget?: {
        type: "camera" | "character" | "object" | "offscreen";
        targetCharacterId?: string;
        targetObjectId?: string;
    };
};

export type SceneIntent = {
    description?: string;
    location?: string;
    environment?: string;
    foreground?: string[];
    background?: string[];
    spatialRelations?: string[];
};

export type FramingIntent = {
    shotSize?: "extreme_close_up" | "close_up" | "medium_close_up" | "medium" | "medium_full" | "full" | "wide";
    subjectPlacement?: "center" | "left_third" | "right_third" | "symmetry";
    headroom?: "tight" | "normal" | "open";
    leadRoom?: "left" | "right" | "none";
    safeArea?: {
        protectHead?: boolean;
        protectHands?: boolean;
        protectFeet?: boolean;
    };
    forbidCrop?: Array<"head" | "face" | "hands" | "feet" | "prop">;
};

export type LightingIntent = {
    keyDirection?: "front" | "left" | "right" | "back" | "top";
    softness?: "hard" | "balanced" | "soft";
    colorTemperature?: "cool" | "neutral" | "warm" | "mixed";
    contrast?: "low" | "medium" | "high";
    timeOfDay?: "dawn" | "day" | "golden_hour" | "night" | "interior";
    practicalLights?: string[];
};

export type CompositionContext = {
    pose?: PoseIntent;
    camera?: CameraIntent;
    scene?: SceneIntent;
    framing?: FramingIntent;
    lighting?: LightingIntent;
};

export type ProtectionRule = {
    id: string;
    target: "identity" | "face" | "hair" | "outfit" | "pose" | "scene" | "original_pixels" | "custom";
    mode: "preserve" | "prefer" | "forbid_change";
    description?: string;
};

export type GenerationIntent = {
    schemaVersion: "1";
    mediaType: MediaGenerationType;
    operation: CanvasOperationKind;
    userPrompt?: string;
    negativePrompt?: string;
    composition?: CompositionContext;
    references?: ReferenceBinding[];
    protections?: ProtectionRule[];
    requestedQualityGates?: string[];
    contextTrace?: {
        storyId?: string;
        sceneId?: string;
        shotId?: string;
        characterId?: string;
    };
};

export type PromptBlockSource =
    | "protection"
    | "identity"
    | "pose"
    | "framing"
    | "camera"
    | "scene"
    | "lighting"
    | "operation"
    | "user_prompt"
    | "negative_prompt";

export type CompiledPromptBlock = {
    source: PromptBlockSource;
    text: string;
};

export type CompiledPrompt = {
    positive: string;
    negative: string;
    blocks: CompiledPromptBlock[];
    warnings: string[];
    removed: Array<{ token: string; reason: string }>;
};

export type CanvasOutpaintMode = "extend" | "full_body";
export type CanvasOutpaintDirection = "up" | "down" | "left" | "right" | "outward";

export type OperationProfile = {
    kind: CanvasOperationKind;
    managed: boolean;
    schemaVersion?: "1";
    profileId?: string;
    mediaType?: MediaGenerationType;
    sourceNodeId?: string;
    modelOverride?: string;
    direction?: CanvasOutpaintDirection;
    outpaintMode?: CanvasOutpaintMode;
    originalPixelLock?: boolean;
    inheritSourceRecipe?: boolean;
    faceProtection?: boolean;
    denoise?: number;
    seamOverlapPixels?: number;
    extensionPixels?: number;
    sourceScale?: number;
    sourceOffsetX?: number;
    sourceOffsetY?: number;
    sourceDrawWidth?: number;
    sourceDrawHeight?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    targetWidth?: number;
    targetHeight?: number;
    baseStorageKey?: string;
    maskStorageKey?: string;
};

export type CapabilityDecision = {
    capabilityId: string;
    status: "selected" | "degraded" | "not_supported" | "missing";
    reason?: string;
    fallbackCapabilityId?: string;
};

export type RuntimeSnapshot = {
    providerId?: string;
    modelId?: string;
    workflowBindingId?: string;
    workflowHash?: string;
    runtimeAssetHashes?: Record<string, string>;
    fallbackNotes?: string[];
};

export type ExecutionPlanValue = {
    value: unknown;
    source: GenerationValueSource;
    sourceNodeId?: string;
    sourceRevision?: number;
};

export type ExecutionPlan = {
    planId: string;
    schemaVersion: "1";
    mediaType: MediaGenerationType;
    operation: CanvasOperationKind;
    compiledPrompt: CompiledPrompt;
    resolvedReferences: ReferenceBinding[];
    values: Record<string, ExecutionPlanValue>;
    capabilityDecisions: CapabilityDecision[];
    workflowBindingId?: string;
    runtimeSnapshot?: RuntimeSnapshot;
    compiledFromHash: string;
    dependencyState: "fresh" | "stale" | "missing_reference" | "compile_error";
};

export type PoseKeypointFormat = "openpose_body_18" | "openpose_body_25" | "coco_wholebody_133" | "custom";
export type PoseAssetMode = "structured" | "render_only";

export type PoseKeypoint = {
    name: string;
    x: number;
    y: number;
    confidence?: number;
    visible?: boolean;
};

export type PosePerson = {
    id: string;
    keypoints: PoseKeypoint[];
    score?: number;
};

export type PoseRenderSpec = {
    schemaVersion: "1";
    colorSchema: "openpose_standard" | "dwpose_standard" | "custom";
    background: "black" | "transparent";
    canvasWidth: number;
    canvasHeight: number;
    lineWidth: number;
    pointRadius: number;
    includeBody: boolean;
    includeHands: boolean;
    includeFace: boolean;
};

export type PoseAsset = {
    id: string;
    schemaVersion: "1";
    revision: number;
    contentHash: string;
    mode: PoseAssetMode;
    format: PoseKeypointFormat;
    source: "detected" | "uploaded" | "editor" | "template";
    sourceNodeId?: string;
    detector?: "openpose" | "dwpose";
    width: number;
    height: number;
    persons: PosePerson[];
    renderSpec: PoseRenderSpec;
    renderedStorageKey: string;
    createdAt: string;
    updatedAt: string;
};

export type PoseControlSettings = {
    poseAssetId: string;
    poseAssetRevision: number;
    poseAssetContentHash: string;
    preprocessor: "openpose" | "dwpose" | "none";
    controlCapabilityId: string;
    modelFamily: "sd15" | "sdxl" | "flux" | "qwen_image";
    baseModelId: string;
    strength: number;
    startPercent: number;
    endPercent: number;
    controlMode: "body" | "body_hands" | "whole_body";
    maxPersons: 1;
};

export type SafetyMode = "hosted_guarded" | "local_standard" | "local_abliterated";

export type RuntimeAssetRequirement = {
    assetId: string;
    sha256: string;
    hashStatus: "registered" | "unregistered";
    loader?: string;
    publisher?: string;
    source?: string;
    license?: string;
    commercialUse?: string;
    licenseUrl?: string;
};

export type WorkflowInputCompatibilityIssue = {
    nodeId: string;
    classType: string;
    unknownFields: string[];
    missingRequiredFields: string[];
};

export type WorkflowBinding = {
    workflowBindingId: string;
    capabilityId: string;
    workflowHash: string;
    workflowFile: string;
    workflowExists: boolean;
    parseError: "" | "workflow_missing" | "invalid_workflow_json" | "unsupported_workflow_shape";
    runtimeProbeStatus: "checked" | "unavailable";
    requiredNodeTypes: string[];
    missingNodeTypes: string[];
    requiredRuntimeAssets: RuntimeAssetRequirement[];
    inputCompatibility: {
        status: "compatible" | "incompatible" | "unavailable";
        issues: WorkflowInputCompatibilityIssue[];
    };
    inputBindings: Record<string, string>;
};

export type ModelCapability = {
    capabilityId: string;
    publisher: string;
    sourceRepo: string;
    sha256: string;
    architecture: string;
    baseModelId?: string | null;
    operations: CanvasOperationKind[];
    mediaTypes: MediaGenerationType[];
    validatedPairs: Array<{
        baseModelId: string;
        controlCapabilityId: string;
        workflowBindingId: string;
        status: "candidate" | "validated" | "rejected";
        baseArchitecture: string;
        controlArchitecture: string;
        evidence: Record<string, unknown>;
    }>;
    safetyMode: SafetyMode | null;
    qualityTier: string | null;
};

export type RegisteredModelCapability = ModelCapability & {
    label: string;
    registryFingerprint: string;
    workflowBindingIds: string[];
    productionDefault: boolean;
    runtime: {
        registryDeclared: boolean;
        filesPresent: boolean;
        loaderVisible: boolean | null;
        nodesPresent: boolean;
        workflowReady: boolean;
        runtimeReady: boolean;
        available: boolean;
        missingNodeTypes: string[];
        missingRuntimeAssets: string[];
        inputCompatibilityIssues: WorkflowInputCompatibilityIssue[];
        optionalMissingNodeTypes?: string[];
        optionalMissingRuntimeAssets?: string[];
        optionalInputCompatibilityIssues?: WorkflowInputCompatibilityIssue[];
        disabledReason: string;
        smokeStatus: "passed" | "failed" | "not_run";
        smokeEvidence: Record<string, unknown>;
    };
};

export type GenerationActualLora = {
    file: string;
    nodeId: string;
    loaderClass: string;
    source: "workflow_template" | "gateway_dynamic";
    strengthModel: number | null;
    strengthClip: number | null;
    stageIds?: string[];
};

export type GenerationLoraEvidence = {
    status: "complete" | "incomplete" | "unknown";
    opaqueSources: Array<{
        nodeId: string | null;
        loaderClass: string | null;
        reason: string;
        stageId?: string;
    }>;
};

export type GenerationExecutionStage = {
    stageId: string;
    stageKind: string;
    taskResult: "succeeded" | "failed";
    promptId: string | null;
    baseCapabilityId: string;
    workflowBindingId: string | null;
    workflowHash: string | null;
    workflowFile: string | null;
    templateField: string;
    effectiveReferenceMode: string;
    adapterKind: string | null;
    mutators: string[];
    fallback: {
        used: boolean;
        requestedReferenceMode: string;
        effectiveReferenceMode: string;
        preset?: {
            from: string;
            to: string;
            reason: string;
        } | null;
    };
    assetVersions: Array<{
        assetId: string;
        sha256: string;
        hashStatus: "registered" | "unregistered";
        license?: string;
        commercialUse?: string;
        licenseUrl?: string;
    }>;
    actualLoras: GenerationActualLora[];
    loraEvidence: GenerationLoraEvidence;
    comfyExecutionSeconds: number | null;
    error: string | null;
};

export type GenerationExecutionReceipt = {
    schemaVersion: "2";
    receiptId: string;
    planned: {
        baseCapabilityId: string;
        baseModelId: string | null;
        requestedReferenceMode: string;
        workflowBindingId: string | null;
        templateField: string;
    };
    primaryStageId: string;
    finalStageId: string;
    stages: GenerationExecutionStage[];
    actual: GenerationExecutionStage & {
        totalComfyExecutionSeconds: number;
    };
};

export type RuntimePreflight = {
    status: "ready" | "degraded" | "unavailable";
    missingNodeTypes: string[];
    missingRuntimeAssets: string[];
    uncheckedLayers: string[];
    capabilityCount: number;
    unavailableCapabilityCount: number;
};

export type CapabilityRegistryResponse = {
    schemaVersion: "1";
    registryVersion: string;
    runtime: {
        comfyUrl: string;
        reachable: boolean;
    };
    capabilities: RegisteredModelCapability[];
    workflowBindings: WorkflowBinding[];
    preflight: RuntimePreflight;
};

export type CapabilityPreflightDecision = {
    status: RuntimePreflight["status"];
    capability?: RegisteredModelCapability;
    workflowBindings: WorkflowBinding[];
    reasons: string[];
};

export type PoseControlRequest = {
    enabled: true;
    pose_asset_snapshot: PoseAsset;
    condition_image_storage_key?: string;
    control_capability_id: string;
    control_strength: number;
    control_start: number;
    control_end: number;
    control_mode: "body" | "body_hands" | "whole_body";
};
