import assert from "node:assert/strict";

import { markDirectDependentsStale } from "../src/lib/canvas/generation-dependencies.ts";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas.ts";
import type { ExecutionPlan } from "../src/types/generation.ts";

const plan: ExecutionPlan = {
    planId: "plan-1",
    schemaVersion: "1",
    mediaType: "image_edit",
    operation: "pose_change",
    compiledPrompt: { positive: "", negative: "", blocks: [], warnings: [], removed: [] },
    resolvedReferences: [{ bindingId: "pose-1", nodeId: "source", role: "pose", revision: 1, contentHash: "hash-1" }],
    values: {},
    capabilityDecisions: [],
    compiledFromHash: "compiled-1",
    dependencyState: "fresh",
};

const node = (id: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Image,
    title: id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 320,
    metadata,
});

const previousNodes = [node("source", { revision: 1, contentHash: "hash-1" }), node("direct", { sharedExecutionPlan: plan }), node("indirect", { sharedExecutionPlan: plan })];
const nextNodes = [node("source", { revision: 2, contentHash: "hash-2" }), previousNodes[1], previousNodes[2]];
const connections = [
    { id: "source-direct", fromNodeId: "source", toNodeId: "direct" },
    { id: "direct-indirect", fromNodeId: "direct", toNodeId: "indirect" },
] as const;
const result = markDirectDependentsStale(previousNodes, nextNodes, [...connections]);

assert.equal(result.find((item) => item.id === "direct")?.metadata?.sharedExecutionPlan?.dependencyState, "stale");
assert.equal(result.find((item) => item.id === "indirect")?.metadata?.sharedExecutionPlan?.dependencyState, "fresh", "P0 must not recursively propagate stale state");
assert.equal(markDirectDependentsStale(nextNodes, nextNodes, [])[0], nextNodes[0], "unchanged revisions must preserve node identity");

Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        clear() {},
        getItem() { return null; },
        key() { return null; },
        removeItem() {},
        setItem() {},
        length: 0,
    },
});
const { useCanvasStore } = await import("../src/stores/canvas/use-canvas-store.ts");
await useCanvasStore.persist.rehydrate();
useCanvasStore.setState({
    projects: [{
        id: "project-1",
        title: "依赖传播验收",
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
        nodes: previousNodes,
        connections: [...connections],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    }],
});
useCanvasStore.getState().updateProject("project-1", { nodes: nextNodes, connections: [...connections] });
const storedNodes = useCanvasStore.getState().projects[0]?.nodes || [];
assert.equal(storedNodes.find((item) => item.id === "direct")?.metadata?.sharedExecutionPlan?.dependencyState, "stale", "store updateProject must mark the direct dependent stale after source revision changes");
assert.equal(storedNodes.find((item) => item.id === "indirect")?.metadata?.sharedExecutionPlan?.dependencyState, "fresh", "store updateProject must not recursively mark indirect dependents stale");
useCanvasStore.setState({ projects: [] });

console.log("generation dependency and store propagation tests passed");
