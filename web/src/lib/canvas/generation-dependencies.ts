import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

function sourceChanged(previous: CanvasNodeData | undefined, next: CanvasNodeData | undefined) {
    if (!previous || !next) return false;
    return previous.metadata?.revision !== next.metadata?.revision || previous.metadata?.contentHash !== next.metadata?.contentHash;
}

function referenceChanged(node: CanvasNodeData, source: CanvasNodeData) {
    const reference = node.metadata?.sharedExecutionPlan?.resolvedReferences.find((item) => item.nodeId === source.id);
    if (!reference) return false;
    return reference.revision !== source.metadata?.revision || reference.contentHash !== source.metadata?.contentHash;
}

export function markDirectDependentsStale(previousNodes: CanvasNodeData[], nextNodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[] {
    const previousById = new Map(previousNodes.map((node) => [node.id, node]));
    const nextById = new Map(nextNodes.map((node) => [node.id, node]));
    const changedSourceIds = new Set(nextNodes.filter((node) => sourceChanged(previousById.get(node.id), node)).map((node) => node.id));
    if (changedSourceIds.size === 0) return nextNodes;

    const staleTargetIds = new Set(
        connections
            .filter((connection) => changedSourceIds.has(connection.fromNodeId))
            .filter((connection) => {
                const target = nextById.get(connection.toNodeId);
                const source = nextById.get(connection.fromNodeId);
                return Boolean(target && source && referenceChanged(target, source));
            })
            .map((connection) => connection.toNodeId),
    );
    if (staleTargetIds.size === 0) return nextNodes;

    return nextNodes.map((node) => {
        const plan = node.metadata?.sharedExecutionPlan;
        if (!staleTargetIds.has(node.id) || !plan || plan.dependencyState !== "fresh") return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                sharedExecutionPlan: { ...plan, dependencyState: "stale" },
            },
        };
    });
}
