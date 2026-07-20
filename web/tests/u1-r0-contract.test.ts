import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    U1_R0_DIRECTIONS,
    U1_R0_REQUEST_HASH_SPEC,
    U1_R0_SEEDS,
    adjudicatePair,
    buildFirstRoundPairSlots,
    buildFirstRoundPlannedCells,
    canonicalizeJson,
    dedupeFindings,
    directionBareWins,
    requestSha256FromHashInput,
    severityScore,
    validateAbRequestHashInputDiff,
    validateAttemptsIntegrity,
    validateFrozenManifestSemantics,
    type U1R0SideEvidence,
} from "../src/lib/canvas/u1-r0-contract.ts";

const require = createRequire(import.meta.url);
// ajv draft 2020-12 (web/node_modules)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Ajv2020 = require("ajv/dist/2020.js");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const u1r0Root = join(repoRoot, ".uat/u1-outpaint/u1-r0");

const template = JSON.parse(readFileSync(join(u1r0Root, "manifest.template.json"), "utf8")) as {
    schemaVersion: string;
    status: string;
    requestHashSpec: string;
    matrix: { plannedCells: number; plannedPairs: number; directions: string[]; seeds: number[] };
    groupA: { loras: unknown[] };
    groupB: { loras: unknown[]; requestLoraKeys: unknown[] };
    plannedCells: Array<{ cellId: string; direction: string; seed: number; group: string }>;
    pairSlots: Array<{ pairId: string; aCellId: string; bCellId: string }>;
    emptyLoraProofPolicy: {
        requireActualLorasEmpty: boolean;
        requireLoraEvidenceComplete: boolean;
        forbidIncompleteOrUnknownAsBare: boolean;
    };
    triggerWordPolicy: {
        abShareCompiledPrompts: boolean;
        forbidProfileAutoTriggerInjection: boolean;
    };
};

const taxonomy = JSON.parse(readFileSync(join(u1r0Root, "taxonomy.profile.json"), "utf8")) as {
    labels: string[];
    severityWeights: { block: number; error: number; warn: number };
    unexpectedObjectSubtypes: string[];
};

// --- matrix contract ---
const planned = buildFirstRoundPlannedCells();
const pairs = buildFirstRoundPairSlots();
assert.equal(planned.length, 18);
assert.equal(pairs.length, 9);
assert.equal(template.matrix.plannedCells, 18);
assert.equal(template.matrix.plannedPairs, 9);
assert.equal(template.plannedCells.length, 18);
assert.equal(template.pairSlots.length, 9);
assert.equal(template.groupA.loras.length, 6);
assert.equal(template.groupB.loras.length, 0);
assert.deepEqual(template.groupB.requestLoraKeys, []);
assert.equal(template.status, "TEMPLATE");
assert.equal(template.requestHashSpec, U1_R0_REQUEST_HASH_SPEC);
assert.deepEqual(template.matrix.directions, [...U1_R0_DIRECTIONS]);
assert.deepEqual(template.matrix.seeds, [...U1_R0_SEEDS]);
assert.equal(template.emptyLoraProofPolicy.requireActualLorasEmpty, true);
assert.equal(template.emptyLoraProofPolicy.requireLoraEvidenceComplete, true);
assert.equal(template.emptyLoraProofPolicy.forbidIncompleteOrUnknownAsBare, true);
assert.equal(template.triggerWordPolicy.abShareCompiledPrompts, true);
assert.equal(template.triggerWordPolicy.forbidProfileAutoTriggerInjection, true);

// template planned cells match generator
assert.deepEqual(
    template.plannedCells.map((item) => ({ cellId: item.cellId, direction: item.direction, seed: item.seed, group: item.group })),
    planned,
);
assert.deepEqual(
    template.pairSlots.map((item) => item.pairId),
    pairs.map((item) => item.pairId),
);

// each pair slot maps to A/B cells of same direction+seed
for (const slot of pairs) {
    assert.equal(slot.aCellId.endsWith("-A"), true);
    assert.equal(slot.bCellId.endsWith("-B"), true);
    assert.ok(planned.some((cell) => cell.cellId === slot.aCellId && cell.group === "A"));
    assert.ok(planned.some((cell) => cell.cellId === slot.bCellId && cell.group === "B"));
}

// --- request hash projection ---
const sampleInput = {
    spec: U1_R0_REQUEST_HASH_SPEC,
    execution: {
        model: {
            capabilityId: "comfy.image.illustrious-mmmix-v8",
            checkpointId: "comfy/illustrious-mmmix-v8",
            sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        loras: [],
        sampler: "euler",
        scheduler: "normal",
        steps: 28,
        cfg: 5,
        direction: "down",
        seed: 424242,
        denoise: 0.6,
        seam: 96,
        extensionRatio: 0.625,
        dimensions: { width: 1024, height: 1664 },
        workflow: {
            bindingId: "txt2img_template",
            version: "v1",
            sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        mutators: [{ id: "canvas_inpaint", version: "v1" }],
        referenceMode: "none",
    },
    inputs: {
        positive: {
            text: "same character downward continuation",
            sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
        negative: {
            text: "second person",
            sha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        },
        base: { sha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
        pad: { sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
        mask: { sha256: "1111111111111111111111111111111111111111111111111111111111111111" },
    },
};

const reordered = {
    inputs: sampleInput.inputs,
    execution: {
        referenceMode: sampleInput.execution.referenceMode,
        mutators: sampleInput.execution.mutators,
        workflow: sampleInput.execution.workflow,
        dimensions: sampleInput.execution.dimensions,
        extensionRatio: sampleInput.execution.extensionRatio,
        seam: sampleInput.execution.seam,
        denoise: sampleInput.execution.denoise,
        seed: sampleInput.execution.seed,
        direction: sampleInput.execution.direction,
        cfg: sampleInput.execution.cfg,
        steps: sampleInput.execution.steps,
        scheduler: sampleInput.execution.scheduler,
        sampler: sampleInput.execution.sampler,
        loras: sampleInput.execution.loras,
        model: sampleInput.execution.model,
    },
    spec: sampleInput.spec,
};

const hashA = requestSha256FromHashInput(sampleInput);
const hashB = requestSha256FromHashInput(reordered);
assert.equal(hashA.requestSha256, hashB.requestSha256, "key order must not change requestSha256");
assert.equal(hashA.jcsUtf8, canonicalizeJson(reordered));
assert.match(hashA.requestSha256, /^[a-f0-9]{64}$/);

// transport-only fields must not be part of the projected input object used by tests
assert.equal("requestId" in sampleInput, false);
assert.equal("timestamp" in sampleInput, false);

// A vs B: only loras may differ
const groupAInput = {
    ...sampleInput,
    execution: {
        ...sampleInput.execution,
        loras: [
            {
                key: "illustrious-masterpiece-v3",
                modelStrength: 0.7,
                clipStrength: 0.7,
                sha256: "2222222222222222222222222222222222222222222222222222222222222222",
            },
        ],
    },
};
const groupBInput = sampleInput;
const hashGroupA = requestSha256FromHashInput(groupAInput);
const hashGroupB = requestSha256FromHashInput(groupBInput);
assert.notEqual(hashGroupA.requestSha256, hashGroupB.requestSha256);

// --- taxonomy ---
assert.deepEqual(taxonomy.labels, [
    "second_subject",
    "camera_prop",
    "anatomy_break",
    "protect_violation",
    "hard_seam",
    "bg_incoherent",
    "unexpected_object",
]);
assert.deepEqual(taxonomy.severityWeights, { block: 3, error: 2, warn: 1 });
assert.ok(!taxonomy.unexpectedObjectSubtypes.includes("camera"));

const deduped = dedupeFindings([
    { label: "unexpected_object", severity: "warn", subtype: "extra_face", physicalId: "face-1" },
    { label: "second_subject", severity: "error", subtype: "extra_face", physicalId: "face-1" },
    { label: "hard_seam", severity: "block", physicalId: "seam-1" },
]);
assert.equal(deduped.length, 2);
assert.equal(deduped.find((item) => item.physicalId === "face-1")?.label, "second_subject");
assert.equal(severityScore(deduped), 2 + 3);

// --- pair adjudication ---
const clean = (over: Partial<U1R0SideEvidence> = {}): U1R0SideEvidence => ({
    selectedAttemptId: "att-1",
    readable: true,
    protectedHardGateFail: false,
    otherHardFail: false,
    findings: [],
    guardNonWorse: true,
    ...over,
});

assert.equal(adjudicatePair(clean({ selectedAttemptId: null }), clean()).pairDisposition, "INVALID");
assert.equal(adjudicatePair(clean(), clean({ protectedHardGateFail: true })).ruleIndex, 1);
assert.equal(adjudicatePair(clean(), clean({ protectedHardGateFail: true })).pairDisposition, "A_WIN");
assert.equal(adjudicatePair(clean({ protectedHardGateFail: true }), clean()).pairDisposition, "B_WIN");
assert.equal(adjudicatePair(clean({ protectedHardGateFail: true }), clean({ protectedHardGateFail: true })).pairDisposition, "INVALID");
assert.equal(adjudicatePair(clean(), clean({ otherHardFail: true })).pairDisposition, "A_WIN");
assert.equal(adjudicatePair(clean({ otherHardFail: true }), clean({ guardNonWorse: true })).pairDisposition, "B_WIN");
assert.equal(adjudicatePair(clean({ otherHardFail: true }), clean({ guardNonWorse: false })).pairDisposition, "TIE");
assert.equal(
    adjudicatePair(
        clean({ findings: [{ label: "hard_seam", severity: "error", physicalId: "s1" }] }),
        clean({ findings: [], guardNonWorse: true }),
    ).pairDisposition,
    "B_WIN",
);
assert.equal(
    adjudicatePair(
        clean({ findings: [{ label: "hard_seam", severity: "warn", physicalId: "s1" }] }),
        clean({ findings: [{ label: "hard_seam", severity: "warn", physicalId: "s2" }] }),
    ).pairDisposition,
    "TIE",
);

assert.equal(directionBareWins(["B_WIN", "B_WIN", "TIE"]), true);
assert.equal(directionBareWins(["B_WIN", "A_WIN", "B_WIN"]), false);
assert.equal(directionBareWins(["B_WIN", "B_WIN", "INVALID"]), false);
assert.equal(directionBareWins(["B_WIN", "B_WIN"]), false);

// --- attempts integrity ---
const cellIds = planned.map((item) => item.cellId);
const hashByCell = Object.fromEntries(cellIds.map((id) => [id, "a".repeat(64)]));
const goodAttempts = cellIds.map((cellId, index) => ({
    attemptId: `att-${index}`,
    cellId,
    requestSha256: "a".repeat(64),
    status: "SUCCEEDED" as const,
    selected: true,
}));
assert.deepEqual(validateAttemptsIntegrity(cellIds, hashByCell, goodAttempts), []);

const rebuilt = [
    ...goodAttempts,
    {
        attemptId: "att-bad",
        cellId: cellIds[0],
        requestSha256: "a".repeat(64),
        status: "FAILED" as const,
        failureClass: "model_or_quality_reject" as const,
        replacesAttemptId: goodAttempts[0].attemptId,
        selected: false,
    },
];
const illegal = validateAttemptsIntegrity(cellIds, hashByCell, rebuilt);
assert.ok(illegal.some((item) => item.code === "illegal_replace_class"));

const doubleSelected = [...goodAttempts, { ...goodAttempts[0], attemptId: "dup", selected: true }];
assert.ok(validateAttemptsIntegrity(cellIds, hashByCell, doubleSelected).some((item) => item.code === "selected_count"));

// cell with only terminal FAILED/CANCELLED and no selected is allowed (unevaluable)
const unevaluableCell = cellIds[0];
const restOk = goodAttempts.filter((item) => item.cellId !== unevaluableCell);
const unevaluableAttempts = [
    ...restOk,
    {
        attemptId: "fail-1",
        cellId: unevaluableCell,
        requestSha256: "a".repeat(64),
        status: "FAILED" as const,
        failureClass: "gateway_unavailable" as const,
        selected: false,
    },
    {
        attemptId: "cancel-1",
        cellId: unevaluableCell,
        requestSha256: "a".repeat(64),
        status: "CANCELLED" as const,
        failureClass: "user_cancelled" as const,
        selected: false,
    },
];
assert.deepEqual(validateAttemptsIntegrity(cellIds, hashByCell, unevaluableAttempts), []);

// missing cell entirely still fails
assert.ok(
    validateAttemptsIntegrity(cellIds, hashByCell, restOk).some(
        (item) => item.code === "no_attempts" && item.message === unevaluableCell,
    ),
);

// A/B structured zero-diff: only loras may differ
assert.deepEqual(validateAbRequestHashInputDiff(groupAInput, groupBInput), []);
const seedDriftB = {
    ...groupBInput,
    execution: { ...groupBInput.execution, seed: 999999 },
};
assert.ok(validateAbRequestHashInputDiff(groupAInput, seedDriftB).some((item) => item.code === "ab_diff_disallowed_key"));
const promptDriftB = {
    ...groupBInput,
    inputs: {
        ...groupBInput.inputs,
        positive: { ...groupBInput.inputs.positive, text: "different prompt" },
    },
};
assert.ok(validateAbRequestHashInputDiff(groupAInput, promptDriftB).some((item) => item.code === "ab_diff_disallowed_key"));

// schemas exist + real draft-2020-12 validation
const schemaNames = [
    "manifest.schema.json",
    "request-hash-input.schema.json",
    "attempts.schema.json",
    "pairs.schema.json",
    "pair-report.schema.json",
    "taxonomy.schema.json",
] as const;
for (const name of schemaNames) {
    const text = readFileSync(join(u1r0Root, "schemas", name), "utf8");
    assert.ok(text.includes("$schema"));
}

const manifestSchema = JSON.parse(readFileSync(join(u1r0Root, "schemas/manifest.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateManifest = ajv.compile(manifestSchema);

assert.equal(validateManifest(template), true, `TEMPLATE must validate: ${ajv.errorsText(validateManifest.errors)}`);

const fakeFrozen = { ...template, status: "FROZEN" };
assert.equal(validateManifest(fakeFrozen), false, "pseudo-FROZEN with null freeze fields must fail");
assert.ok((validateManifest.errors || []).length > 0);

const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const frozenLora = (key: string, n: number) => ({
    key,
    modelStrength: 0.7,
    clipStrength: 0.7,
    sha256: hex(n),
});
const frozenPrompt = (text: string, n: number) => ({
    text,
    sha256: hex(n),
});
const frozenArtifact = (n: number) => ({ sha256: hex(n) });
const groupALoras = [
    frozenLora("illustrious-masterpiece-v3", 20),
    frozenLora("bss-detail-enhancer-v3", 21),
    frozenLora("bss-visual-enhancer-v3", 22),
    frozenLora("bss-skin-texture-v2", 23),
    frozenLora("eyes-for-illustrious", 24),
    frozenLora("dramatic-lighting-slider", 25),
];
const promptsByDirection = {
    up: { positive: frozenPrompt("up+", 30), negative: frozenPrompt("up-", 31) },
    down: { positive: frozenPrompt("down+", 32), negative: frozenPrompt("down-", 33) },
    outward: { positive: frozenPrompt("out+", 34), negative: frozenPrompt("out-", 35) },
} as const;
const denoiseByDirection = { up: 0.78, down: 0.6, outward: 0.78 } as const;
const seamByDirection = { up: 112, down: 96, outward: 104 } as const;
const extensionRatioByDirection = { up: 0.625, down: 0.625, outward: 0.625 } as const;
const artifactsByDirection = {
    up: { base: frozenArtifact(40), pad: frozenArtifact(41), mask: frozenArtifact(42), targetWidth: 1024, targetHeight: 1664 },
    down: { base: frozenArtifact(43), pad: frozenArtifact(44), mask: frozenArtifact(45), targetWidth: 1024, targetHeight: 1664 },
    outward: { base: frozenArtifact(46), pad: frozenArtifact(47), mask: frozenArtifact(48), targetWidth: 1024, targetHeight: 1664 },
} as const;

function buildCellHashInput(cell: { direction: string; seed: number; group: string }) {
    const direction = cell.direction as keyof typeof promptsByDirection;
    const prompts = promptsByDirection[direction];
    const artifacts = artifactsByDirection[direction];
    return {
        spec: U1_R0_REQUEST_HASH_SPEC,
        execution: {
            model: {
                capabilityId: "comfy.image.illustrious-mmmix-v8",
                checkpointId: "comfy/illustrious-mmmix-v8",
                sha256: hex(2),
            },
            loras: cell.group === "A" ? groupALoras : [],
            sampler: "euler",
            scheduler: "normal",
            steps: 28,
            cfg: 5,
            direction: cell.direction,
            seed: cell.seed,
            denoise: denoiseByDirection[direction],
            seam: seamByDirection[direction],
            extensionRatio: extensionRatioByDirection[direction],
            dimensions: { width: 1024, height: 1664 },
            workflow: { bindingId: "txt2img_template", version: "v1", sha256: hex(50) },
            mutators: [{ id: "canvas_inpaint", version: "v1" }],
            referenceMode: "none",
        },
        inputs: {
            positive: prompts.positive,
            negative: prompts.negative,
            base: artifacts.base,
            pad: artifacts.pad,
            mask: artifacts.mask,
        },
    };
}

const minimalFrozen = {
    ...template,
    status: "FROZEN",
    createdAt: "2026-07-20T00:00:00.000Z",
    source: {
        path: ".uat/u1-outpaint/baseline/u1-character-baseline.png",
        sha256: hex(1),
        width: 1024,
        height: 1024,
    },
    model: {
        capabilityId: "comfy.image.illustrious-mmmix-v8",
        checkpointId: "comfy/illustrious-mmmix-v8",
        sha256: hex(2),
    },
    groupA: {
        profileId: "frozen-profile",
        profileVersion: "v1",
        profileHash: hex(3),
        loras: groupALoras,
    },
    groupB: { loras: [], requestLoraKeys: [] },
    promptsByDirection,
    sampling: {
        sampler: "euler",
        scheduler: "normal",
        steps: 28,
        cfg: 5,
        denoiseByDirection,
        seamByDirection,
        extensionRatioByDirection,
    },
    artifactsByDirection,
    workflow: {
        bindingId: "txt2img_template",
        version: "v1",
        sha256: hex(50),
    },
    mutators: [{ id: "canvas_inpaint", version: "v1" }],
    codeFingerprint: {
        commit: "deadbeef",
        worktreeDiffSha256: hex(51),
    },
    plannedCells: template.plannedCells.map((cell) => {
        const requestHashInput = buildCellHashInput(cell);
        const projected = requestSha256FromHashInput(requestHashInput);
        return {
            ...cell,
            requestSha256: projected.requestSha256,
            requestHashInput,
            requestHashInputJcsUtf8Base64: projected.jcsUtf8Base64,
        };
    }),
};
assert.equal(validateManifest(minimalFrozen), true, `minimal FROZEN must validate: ${ajv.errorsText(validateManifest.errors)}`);
assert.deepEqual(validateFrozenManifestSemantics(minimalFrozen), []);

// empty object requestHashInput must fail FROZEN schema
const emptyHashFrozen = {
    ...minimalFrozen,
    plannedCells: minimalFrozen.plannedCells.map((cell, index) =>
        index === 0 ? { ...cell, requestHashInput: {} } : cell,
    ),
};
assert.equal(validateManifest(emptyHashFrozen), false, "empty requestHashInput must fail FROZEN schema");

// shared identical hash across all cells must fail semantic validation
const sharedHashInput = buildCellHashInput({ direction: "down", seed: 424242, group: "B" });
const sharedProjected = requestSha256FromHashInput(sharedHashInput);
const sharedHashFrozen = {
    ...minimalFrozen,
    plannedCells: minimalFrozen.plannedCells.map((cell) => ({
        ...cell,
        requestSha256: sharedProjected.requestSha256,
        requestHashInput: sharedHashInput,
        requestHashInputJcsUtf8Base64: sharedProjected.jcsUtf8Base64,
    })),
};
const sharedIssues = validateFrozenManifestSemantics(sharedHashFrozen);
assert.ok(
    sharedIssues.some(
        (item) =>
            item.code === "cell_direction_mismatch"
            || item.code === "cell_seed_mismatch"
            || item.code === "cell_group_a_loras_mismatch"
            || item.code === "pair_lora_contrast",
    ),
);

// identity tamper: re-label A cells as B with empty LoRA must fail fixed matrix identity
const identityTamperFrozen = {
    ...minimalFrozen,
    plannedCells: minimalFrozen.plannedCells.map((cell) => {
        if (cell.group !== "A") return cell;
        const requestHashInput = buildCellHashInput({ direction: cell.direction, seed: cell.seed, group: "B" });
        const projected = requestSha256FromHashInput(requestHashInput);
        return {
            ...cell,
            group: "B",
            requestSha256: projected.requestSha256,
            requestHashInput,
            requestHashInputJcsUtf8Base64: projected.jcsUtf8Base64,
        };
    }),
};
const identityIssues = validateFrozenManifestSemantics(identityTamperFrozen);
assert.ok(identityIssues.some((item) => item.code === "cell_identity_mismatch"));
assert.ok(identityIssues.some((item) => item.code === "pair_lora_contrast" || item.code === "pair_identical_request"));

// top-level freeze values must match each cell requestHashInput
const topLevelDriftFrozen = {
    ...minimalFrozen,
    plannedCells: minimalFrozen.plannedCells.map((cell) => {
        const requestHashInput = structuredClone(cell.requestHashInput) as ReturnType<typeof buildCellHashInput>;
        requestHashInput.execution.sampler = "dpmpp_2m";
        const projected = requestSha256FromHashInput(requestHashInput);
        return {
            ...cell,
            requestSha256: projected.requestSha256,
            requestHashInput,
            requestHashInputJcsUtf8Base64: projected.jcsUtf8Base64,
        };
    }),
};
assert.ok(validateFrozenManifestSemantics(topLevelDriftFrozen).some((item) => item.code === "cell_sampling_mismatch"));

// top-level matrix must match fixed first-round matrix
const matrixDriftFrozen = {
    ...minimalFrozen,
    matrix: {
        directions: [],
        seeds: [],
        groups: [],
        plannedCells: 18,
        plannedPairs: 9,
    },
};
const matrixIssues = validateFrozenManifestSemantics(matrixDriftFrozen);
assert.ok(matrixIssues.some((item) => item.code === "matrix_directions"));
assert.ok(matrixIssues.some((item) => item.code === "matrix_seeds"));
assert.ok(matrixIssues.some((item) => item.code === "matrix_groups"));

// target dimensions must be frozen and match execution.dimensions
const sizeDriftFrozen = {
    ...minimalFrozen,
    plannedCells: minimalFrozen.plannedCells.map((cell) => {
        const requestHashInput = structuredClone(cell.requestHashInput) as ReturnType<typeof buildCellHashInput>;
        requestHashInput.execution.dimensions = { width: 768, height: 1280 };
        const projected = requestSha256FromHashInput(requestHashInput);
        return {
            ...cell,
            requestSha256: projected.requestSha256,
            requestHashInput,
            requestHashInputJcsUtf8Base64: projected.jcsUtf8Base64,
        };
    }),
};
assert.ok(validateFrozenManifestSemantics(sizeDriftFrozen).some((item) => item.code === "cell_dimensions_mismatch"));

console.log("u1-r0 contract tests passed");
