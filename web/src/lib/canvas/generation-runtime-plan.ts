import { nanoid } from "nanoid";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { normalizeAssetId, normalizeMissingRuntimeAssetId } from "@/services/api/comfy";
import type {
    CapabilityPreflightDecision,
    ExecutionPlan,
    MediaGenerationType,
    ReferenceBinding,
    ReferenceRole,
    WorkflowBinding,
} from "@/types/generation";
import type { ReferenceImage } from "@/types/image";

type BuildComfyExecutionPlanInput = {
    model: string;
    prompt: string;
    mediaType: MediaGenerationType;
    operation: ExecutionPlan["operation"];
    count: number;
    references: ReferenceImage[];
    nodes: CanvasNodeData[];
    sourceNodeId?: string;
    referenceMode?: string;
    decision: CapabilityPreflightDecision;
};

function stableHash(value: unknown) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function referenceRole(index: number, image: ReferenceImage, sourceNodeId?: string): ReferenceRole {
    if (image.id === sourceNodeId || index === 0) return "body_identity";
    return "style";
}

export function resolveImageReferenceBindings(references: ReferenceImage[], nodes: CanvasNodeData[], sourceNodeId?: string): ReferenceBinding[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const sourceNode = sourceNodeId ? nodeById.get(sourceNodeId) : undefined;
    return references.map((image, index) => {
        const nodeId = index === 0 && sourceNode?.type === CanvasNodeType.Image && sourceNode.metadata?.content ? sourceNode.id : image.id;
        const node = nodeById.get(nodeId);
        return {
            bindingId: `image-reference:${image.id}:${index}`,
            nodeId,
            role: referenceRole(index, image, sourceNodeId),
            revision: node?.metadata?.revision,
            contentHash: node?.metadata?.contentHash,
            required: true,
            scope: "operation",
        };
    });
}

function isExecutableWorkflowBinding(item: WorkflowBinding, missingRuntimeAssetIds: Set<string>) {
    if (!item.workflowExists || item.parseError || item.runtimeProbeStatus !== "checked" || item.missingNodeTypes.length) return false;
    // Missing inputCompatibility is treated as unknown/legacy; only explicit non-compatible blocks selection.
    if (item.inputCompatibility && item.inputCompatibility.status !== "compatible") return false;
    if (item.requiredRuntimeAssets.some((asset) => missingRuntimeAssetIds.has(normalizeAssetId(asset.assetId)))) return false;
    return true;
}

export function buildComfyExecutionPlan(input: BuildComfyExecutionPlanInput): ExecutionPlan {
    const missingRuntimeAssetIds = new Set(
        [
            ...(input.decision.capability?.runtime.missingRuntimeAssets || []),
            ...(input.decision.capability?.runtime.optionalMissingRuntimeAssets || []),
        ].map(normalizeMissingRuntimeAssetId),
    );
    const validBindings = [...input.decision.workflowBindings]
        .filter((item) => isExecutableWorkflowBinding(item, missingRuntimeAssetIds))
        .sort((left, right) => left.workflowBindingId.localeCompare(right.workflowBindingId));
    const referenceMode = input.referenceMode?.trim().toLowerCase();
    const preferredTemplateField =
        !input.references.length || referenceMode === "none"
            ? "txt2img_template"
            : referenceMode === "img2img"
              ? "img2img_template"
              : referenceMode === "ipadapter" || referenceMode === "ipadapter_character"
                ? "ipadapter_template"
                : referenceMode === "faceid"
                  ? "faceid_template"
                  : referenceMode === "faceid_style"
                    ? "faceid_style_template"
                    : referenceMode === "identity_clone"
                      ? "identity_clone_template"
                      : referenceMode === "controlnet"
                        ? "controlnet_template"
                        : undefined;
    const binding = preferredTemplateField ? validBindings.find((item) => item.inputBindings.templateField === preferredTemplateField) : undefined;
    const preferredBindingPresent = preferredTemplateField
        ? input.decision.workflowBindings.some((item) => item.inputBindings.templateField === preferredTemplateField)
        : false;
    const resolvedReferences = resolveImageReferenceBindings(input.references, input.nodes, input.sourceNodeId);
    const fallbackNotes = [
        ...new Set([
            ...input.decision.reasons,
            ...(!preferredTemplateField && input.references.length
                ? [`参考模式 ${referenceMode || "registry_default"} 缺少能力专用 WorkflowBinding 映射，提交前不伪造实际工作流`]
                : preferredTemplateField && !binding
                  ? [
                        preferredBindingPresent
                            ? `${preferredTemplateField} 不可执行（输入不兼容或运行时资产缺失），提交前不伪造实际工作流`
                            : `未找到 ${preferredTemplateField}，提交前不伪造实际工作流`,
                    ]
                  : []),
        ]),
    ];
    const capabilityId = input.decision.capability?.capabilityId || `comfy.image.${input.model}`;
    const runtimeAssetHashes = Object.fromEntries([
        ...(input.decision.capability?.sha256 ? [[`capability:${capabilityId}`, input.decision.capability.sha256] as const] : []),
        ...(binding?.requiredRuntimeAssets || [])
            .filter((asset) => asset.sha256)
            .map((asset) => [asset.assetId, asset.sha256] as const),
    ]);
    const compiledPrompt = {
        positive: input.prompt,
        negative: "",
        blocks: input.prompt ? [{ source: "user_prompt" as const, text: input.prompt }] : [],
        warnings: fallbackNotes,
        removed: [],
    };
    const compiledFromHash = stableHash({
        model: input.model,
        prompt: input.prompt,
        mediaType: input.mediaType,
        operation: input.operation,
        count: input.count,
        referenceMode,
        resolvedReferences,
        capabilityId,
        workflowBindingId: binding?.workflowBindingId,
    });

    return {
        planId: nanoid(),
        schemaVersion: "1",
        mediaType: input.mediaType,
        operation: input.operation,
        compiledPrompt,
        resolvedReferences,
        values: {
            model: { value: input.model, source: "manual_node" },
            requestCount: { value: 1, source: "operation_profile" },
            batchCount: { value: input.count, source: "manual_node" },
        },
        capabilityDecisions: [
            {
                capabilityId,
                status: input.decision.status === "ready" && !fallbackNotes.length ? "selected" : "degraded",
                reason: fallbackNotes.join("；") || undefined,
            },
        ],
        workflowBindingId: binding?.workflowBindingId,
        runtimeSnapshot: {
            providerId: "comfy",
            modelId: input.model,
            workflowBindingId: binding?.workflowBindingId,
            workflowHash: binding?.workflowHash || undefined,
            runtimeAssetHashes: Object.keys(runtimeAssetHashes).length ? runtimeAssetHashes : undefined,
            fallbackNotes: fallbackNotes.length ? fallbackNotes : undefined,
        },
        compiledFromHash,
        dependencyState: resolvedReferences.some((reference) => reference.required && !reference.nodeId) ? "missing_reference" : "fresh",
    };
}

export function cloneComfyExecutionPlan(plan: ExecutionPlan | undefined): ExecutionPlan | undefined {
    if (!plan) return undefined;
    return {
        ...plan,
        compiledPrompt: {
            ...plan.compiledPrompt,
            blocks: plan.compiledPrompt.blocks.map((block) => ({ ...block })),
            warnings: [...plan.compiledPrompt.warnings],
            removed: plan.compiledPrompt.removed.map((item) => ({ ...item })),
        },
        values: Object.fromEntries(
            Object.entries(plan.values).map(([key, value]) => [
                key,
                {
                    ...value,
                    value: Array.isArray(value.value) ? [...value.value] : value.value,
                },
            ]),
        ),
        capabilityDecisions: plan.capabilityDecisions.map((decision) => ({ ...decision })),
        resolvedReferences: plan.resolvedReferences.map((reference) => ({ ...reference })),
        runtimeSnapshot: plan.runtimeSnapshot
            ? {
                  ...plan.runtimeSnapshot,
                  runtimeAssetHashes: plan.runtimeSnapshot.runtimeAssetHashes ? { ...plan.runtimeSnapshot.runtimeAssetHashes } : undefined,
                  fallbackNotes: plan.runtimeSnapshot.fallbackNotes ? [...plan.runtimeSnapshot.fallbackNotes] : undefined,
              }
            : undefined,
    };
}

export function replayComfyExecutionPlan(plan: ExecutionPlan | undefined): ExecutionPlan | undefined {
    const cloned = cloneComfyExecutionPlan(plan);
    if (!cloned) return undefined;
    return {
        ...cloned,
        planId: nanoid(),
        operation: "exact_replay",
        values: Object.fromEntries(
            Object.entries(cloned.values).map(([key, value]) => [
                key,
                {
                    ...value,
                    source: "exact_replay" as const,
                },
            ]),
        ),
        dependencyState: "fresh",
    };
}

export function revalidateReplayedComfyExecutionPlan(plan: ExecutionPlan | undefined, decision: CapabilityPreflightDecision): ExecutionPlan | undefined {
    const replayed = replayComfyExecutionPlan(plan);
    if (!replayed) return undefined;
    const capabilityId = decision.capability?.capabilityId || replayed.capabilityDecisions[0]?.capabilityId;
    const gateReasons = [...new Set(decision.reasons.filter(Boolean))];
    const currentIndex = replayed.capabilityDecisions.findIndex((item) => item.capabilityId === capabilityId);
    const current = replayed.capabilityDecisions[currentIndex];
    const reasons = [...new Set([current?.reason, ...gateReasons].filter(Boolean) as string[])];
    const gateDecision = capabilityId
        ? {
              capabilityId,
              status: current?.status === "selected" && decision.status === "ready" && !gateReasons.length ? ("selected" as const) : ("degraded" as const),
              reason: reasons.join("；") || undefined,
          }
        : undefined;
    const capabilityDecisions = replayed.capabilityDecisions.map((item, index) => (index === currentIndex && gateDecision ? { ...item, ...gateDecision } : item));
    if (gateDecision && currentIndex < 0) capabilityDecisions.push(gateDecision);
    const fallbackNotes = [...new Set([...(replayed.runtimeSnapshot?.fallbackNotes || []), ...gateReasons])];
    return {
        ...replayed,
        capabilityDecisions,
        runtimeSnapshot: replayed.runtimeSnapshot
            ? {
                  ...replayed.runtimeSnapshot,
                  fallbackNotes: fallbackNotes.length ? fallbackNotes : undefined,
              }
            : undefined,
    };
}

export function createImageContentVersion(image: { storageKey: string; bytes: number; width: number; height: number }, previousRevision?: number) {
    return {
        revision: (previousRevision || 0) + 1,
        contentHash: stableHash({
            storageKey: image.storageKey,
            bytes: image.bytes,
            width: image.width,
            height: image.height,
        }),
    };
}
