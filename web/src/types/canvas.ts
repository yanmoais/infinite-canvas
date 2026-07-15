export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasOperationKind = "manual" | "inpaint" | "outpaint" | "character_atelier" | "exact_replay";
export type CanvasOutpaintMode = "extend" | "full_body";
export type CanvasOutpaintDirection = "up" | "down" | "left" | "right" | "outward";
export type CanvasGenerationValueSource = "manual_node" | "source_recipe" | "operation_profile" | "preset_default" | "exact_replay";

export type CanvasGenerationSettings = {
    model?: string;
    promptModel?: string;
    size?: string;
    quality?: string;
    count?: number;
    referenceMode?: string;
    loras?: string[];
    faceDetailer?: boolean;
    denoise?: number | null | false;
};

export type CanvasSourceGenerationRecipe = CanvasGenerationSettings & {
    generationType?: CanvasImageGenerationType;
    references?: string[];
};

export type CanvasOperationProfile = {
    kind: CanvasOperationKind;
    managed: boolean;
    sourceNodeId?: string;
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

export type CanvasExecutionPlanValue = {
    value: string | number | boolean | string[] | null;
    source: CanvasGenerationValueSource;
};

export type CanvasExecutionPlan = {
    operation: CanvasOperationKind;
    managed: boolean;
    createdAt: string;
    values: Partial<Record<keyof CanvasGenerationSettings, CanvasExecutionPlanValue>>;
    protections?: string[];
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    originalPrompt?: string;
    originalIdentityPrompt?: string;
    promptDraft?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    promptModel?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    comfyReferenceMode?: string;
    comfyLoras?: string[];
    comfyFaceDetailer?: boolean;
    comfyDenoise?: number | null | false;
    manualNodeSettings?: CanvasGenerationSettings;
    sourceGenerationRecipe?: CanvasSourceGenerationRecipe;
    operationProfile?: CanvasOperationProfile;
    executionPlan?: CanvasExecutionPlan;
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    groupId?: string;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeType;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
