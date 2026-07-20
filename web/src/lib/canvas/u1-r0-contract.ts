/**
 * U1-R0 offline contract helpers.
 * Pure functions for planned matrix, request hash projection, pair adjudication,
 * taxonomy dedupe and attempt integrity. Not a GPU runner.
 */

import { createHash } from "node:crypto";

export const U1_R0_REQUEST_HASH_SPEC = "u1-r0-request-v1" as const;
export const U1_R0_DIRECTIONS = ["up", "down", "outward"] as const;
export const U1_R0_SEEDS = [424242, 424243, 777001] as const;
export const U1_R0_GROUPS = ["A", "B"] as const;

export type U1R0Direction = (typeof U1_R0_DIRECTIONS)[number] | "left" | "right";
export type U1R0Group = (typeof U1_R0_GROUPS)[number];
export type U1R0PairDisposition = "B_WIN" | "A_WIN" | "TIE" | "INVALID";
export type U1R0Severity = "block" | "error" | "warn";
export type U1R0TaxonomyLabel =
    | "second_subject"
    | "camera_prop"
    | "anatomy_break"
    | "protect_violation"
    | "hard_seam"
    | "bg_incoherent"
    | "unexpected_object";

export type U1R0Finding = {
    label: U1R0TaxonomyLabel;
    severity: U1R0Severity;
    subtype?: "extra_face" | "extra_limb" | "unexpected_accessory" | "other";
    /** Stable physical-finding key used for dedupe across conflicting labels. */
    physicalId: string;
};

export type U1R0SideEvidence = {
    selectedAttemptId: string | null;
    readable: boolean;
    protectedHardGateFail: boolean;
    otherHardFail: boolean;
    findings: U1R0Finding[];
    guardNonWorse: boolean;
};

export type U1R0Attempt = {
    attemptId: string;
    cellId: string;
    requestSha256: string;
    status: "SUCCEEDED" | "FAILED" | "CANCELLED";
    failureClass?:
        | "gateway_unavailable"
        | "gateway_internal_error"
        | "artifact_storage_error"
        | "model_or_quality_reject"
        | "timeout_unknown_cause"
        | "request_or_workflow_validation_error"
        | "asset_or_receipt_proof_missing"
        | "user_cancelled"
        | "protocol_deviation";
    replacesAttemptId?: string | null;
    selected: boolean;
};

export type U1R0PlannedCell = {
    cellId: string;
    direction: U1R0Direction;
    seed: number;
    group: U1R0Group;
};

export type U1R0PairSlot = {
    pairId: string;
    direction: U1R0Direction;
    seed: number;
    aCellId: string;
    bCellId: string;
};

export const SEVERITY_WEIGHTS: Record<U1R0Severity, number> = {
    block: 3,
    error: 2,
    warn: 1,
};

export const DEDUPE_PRIORITY: U1R0TaxonomyLabel[] = [
    "second_subject",
    "camera_prop",
    "anatomy_break",
    "unexpected_object",
];

const REPLACEABLE_FAILURES = new Set([
    "gateway_unavailable",
    "gateway_internal_error",
    "artifact_storage_error",
]);

/** Deterministic JSON canonicalization for U1-R0 requestHashInput (JCS-compatible for our value set). */
export function canonicalizeJson(value: unknown): string {
    return canonicalizeValue(value);
}

function canonicalizeValue(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("JCS number must be finite");
        // Integers and simple decimals; avoid -0
        if (Object.is(value, -0)) return "0";
        return Number.isInteger(value) ? String(value) : JSON.stringify(value);
    }
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalizeValue(item)).join(",")}]`;
    }
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeValue(v)}`).join(",")}}`;
    }
    throw new Error(`Unsupported JSON value type: ${typeof value}`);
}

export function sha256Hex(input: string | Buffer): string {
    return createHash("sha256").update(input).digest("hex");
}

export function requestSha256FromHashInput(requestHashInput: unknown): {
    jcsUtf8: string;
    jcsUtf8Base64: string;
    requestSha256: string;
} {
    const jcsUtf8 = canonicalizeJson(requestHashInput);
    return {
        jcsUtf8,
        jcsUtf8Base64: Buffer.from(jcsUtf8, "utf8").toString("base64"),
        requestSha256: sha256Hex(jcsUtf8),
    };
}

export function buildFirstRoundPlannedCells(): U1R0PlannedCell[] {
    const cells: U1R0PlannedCell[] = [];
    for (const direction of U1_R0_DIRECTIONS) {
        for (const seed of U1_R0_SEEDS) {
            for (const group of U1_R0_GROUPS) {
                cells.push({
                    cellId: `u1r0-${direction}-${seed}-${group}`,
                    direction,
                    seed,
                    group,
                });
            }
        }
    }
    return cells;
}

export function buildFirstRoundPairSlots(): U1R0PairSlot[] {
    return U1_R0_DIRECTIONS.flatMap((direction) =>
        U1_R0_SEEDS.map((seed) => ({
            pairId: `u1r0-pair-${direction}-${seed}`,
            direction,
            seed,
            aCellId: `u1r0-${direction}-${seed}-A`,
            bCellId: `u1r0-${direction}-${seed}-B`,
        })),
    );
}

export function dedupeFindings(findings: U1R0Finding[]): U1R0Finding[] {
    const byPhysical = new Map<string, U1R0Finding>();
    for (const finding of findings) {
        const existing = byPhysical.get(finding.physicalId);
        if (!existing) {
            byPhysical.set(finding.physicalId, finding);
            continue;
        }
        const existingRank = DEDUPE_PRIORITY.indexOf(existing.label);
        const nextRank = DEDUPE_PRIORITY.indexOf(finding.label);
        const existingScore = existingRank === -1 ? Number.MAX_SAFE_INTEGER : existingRank;
        const nextScore = nextRank === -1 ? Number.MAX_SAFE_INTEGER : nextRank;
        if (nextScore < existingScore) byPhysical.set(finding.physicalId, finding);
    }
    return [...byPhysical.values()];
}

export function severityScore(findings: U1R0Finding[]): number {
    return dedupeFindings(findings).reduce((sum, item) => sum + SEVERITY_WEIGHTS[item.severity], 0);
}

export function adjudicatePair(a: U1R0SideEvidence, b: U1R0SideEvidence): {
    pairDisposition: U1R0PairDisposition;
    ruleIndex: number;
    summary: string;
    aSeverity: number;
    bSeverity: number;
} {
    const aSeverity = severityScore(a.findings);
    const bSeverity = severityScore(b.findings);

    const decide = (ruleIndex: number, pairDisposition: U1R0PairDisposition, summary: string) => ({
        pairDisposition,
        ruleIndex,
        summary,
        aSeverity,
        bSeverity,
    });

    if (!a.readable || !b.readable || !a.selectedAttemptId || !b.selectedAttemptId) {
        return decide(0, "INVALID", "unreadable or missing selected attempt");
    }
    if (b.protectedHardGateFail && !a.protectedHardGateFail) return decide(1, "A_WIN", "protected hard gate: B only");
    if (a.protectedHardGateFail && !b.protectedHardGateFail) return decide(2, "B_WIN", "protected hard gate: A only");
    if (a.protectedHardGateFail && b.protectedHardGateFail) return decide(3, "INVALID", "protected hard gate: both");
    if (b.otherHardFail && !a.otherHardFail) return decide(4, "A_WIN", "other hard fail: B only");
    if (a.otherHardFail && !b.otherHardFail && b.guardNonWorse) return decide(5, "B_WIN", "other hard fail: A only, B guard non-worse");
    if (a.otherHardFail && !b.otherHardFail && !b.guardNonWorse) return decide(6, "TIE", "other hard fail: A only, B guard worse");
    if (a.otherHardFail && b.otherHardFail) return decide(7, "INVALID", "other hard fail: both");
    if (bSeverity <= aSeverity - 1 && b.guardNonWorse) return decide(8, "B_WIN", "severity favors B with guard non-worse");
    if (aSeverity <= bSeverity - 1 && a.guardNonWorse) return decide(9, "A_WIN", "severity favors A with guard non-worse");
    if (aSeverity !== bSeverity || a.guardNonWorse !== b.guardNonWorse) {
        return decide(10, "TIE", "conflicting severity/guard dimensions");
    }
    return decide(11, "TIE", "evidence does not support a one-sided win");
}

export function directionBareWins(dispositions: U1R0PairDisposition[]): boolean {
    if (dispositions.length !== 3) return false;
    if (dispositions.some((item) => item === "INVALID")) return false;
    const bWins = dispositions.filter((item) => item === "B_WIN").length;
    const aWins = dispositions.filter((item) => item === "A_WIN").length;
    return bWins >= 2 && aWins === 0;
}

export type AttemptIntegrityIssue = { code: string; message: string };

export function validateAttemptsIntegrity(
    plannedCellIds: string[],
    plannedRequestShaByCell: Record<string, string>,
    attempts: U1R0Attempt[],
): AttemptIntegrityIssue[] {
    const issues: AttemptIntegrityIssue[] = [];
    const byId = new Map(attempts.map((item) => [item.attemptId, item]));
    const selectedByCell = new Map<string, U1R0Attempt[]>();

    for (const attempt of attempts) {
        if (attempt.status === "SUCCEEDED") {
            if (attempt.failureClass) issues.push({ code: "succeeded_has_failure", message: attempt.attemptId });
            if (attempt.replacesAttemptId) issues.push({ code: "succeeded_has_replace", message: attempt.attemptId });
        }
        if (attempt.status === "FAILED" && !attempt.failureClass) {
            issues.push({ code: "failed_missing_class", message: attempt.attemptId });
        }
        if (attempt.status === "CANCELLED") {
            if (attempt.failureClass !== "user_cancelled") issues.push({ code: "cancel_class", message: attempt.attemptId });
            if (attempt.replacesAttemptId) issues.push({ code: "cancel_replace", message: attempt.attemptId });
        }
        if (attempt.replacesAttemptId) {
            if (attempt.status !== "FAILED" || !attempt.failureClass || !REPLACEABLE_FAILURES.has(attempt.failureClass)) {
                issues.push({ code: "illegal_replace_class", message: attempt.attemptId });
            }
            const prev = byId.get(attempt.replacesAttemptId);
            if (!prev) issues.push({ code: "replace_missing_prev", message: attempt.attemptId });
            else if (prev.cellId !== attempt.cellId) issues.push({ code: "replace_cell_mismatch", message: attempt.attemptId });
            else if (prev.requestSha256 !== attempt.requestSha256) issues.push({ code: "replace_hash_mismatch", message: attempt.attemptId });
        }
        if (attempt.selected) {
            const list = selectedByCell.get(attempt.cellId) || [];
            list.push(attempt);
            selectedByCell.set(attempt.cellId, list);
        }
    }

    // replacement predecessor uniqueness
    const replaced = attempts.map((item) => item.replacesAttemptId).filter((id): id is string => Boolean(id));
    const seenPrev = new Set<string>();
    for (const prevId of replaced) {
        if (seenPrev.has(prevId)) issues.push({ code: "replace_multi_child", message: prevId });
        seenPrev.add(prevId);
    }

    // no cycles
    for (const attempt of attempts) {
        const visited = new Set<string>();
        let current: U1R0Attempt | undefined = attempt;
        while (current?.replacesAttemptId) {
            if (visited.has(current.attemptId)) {
                issues.push({ code: "replace_cycle", message: attempt.attemptId });
                break;
            }
            visited.add(current.attemptId);
            current = byId.get(current.replacesAttemptId);
        }
    }

    const attemptsByCell = new Map<string, U1R0Attempt[]>();
    for (const attempt of attempts) {
        const list = attemptsByCell.get(attempt.cellId) || [];
        list.push(attempt);
        attemptsByCell.set(attempt.cellId, list);
    }

    for (const cellId of plannedCellIds) {
        const selected = selectedByCell.get(cellId) || [];
        if (selected.length > 1) {
            issues.push({ code: "selected_count", message: `${cellId}:${selected.length}` });
            continue;
        }
        if (selected.length === 1) {
            const item = selected[0];
            const expected = plannedRequestShaByCell[cellId];
            if (expected && item.requestSha256 !== expected) {
                issues.push({ code: "selected_hash_mismatch", message: cellId });
            }
            continue;
        }

        // selected.length === 0
        const cellAttempts = attemptsByCell.get(cellId) || [];
        if (cellAttempts.length === 0) {
            issues.push({ code: "no_attempts", message: cellId });
            continue;
        }
        const allTerminalUnevaluable = cellAttempts.every(
            (item) => !item.selected && (item.status === "FAILED" || item.status === "CANCELLED"),
        );
        if (!allTerminalUnevaluable) {
            issues.push({ code: "unevaluable_incomplete", message: cellId });
        }
    }

    return issues;
}

/** Structured A/B request diff may only differ on LoRA-related keys. */
export function abRequestDiffAllowedKeys(): string[] {
    return ["loras", "lora_keys", "actualLoras"];
}

const AB_DIFF_ALLOWED = new Set(abRequestDiffAllowedKeys());

/**
 * Validate that two requestHashInput objects differ only in LoRA fields.
 * Contract: A/B may only differ in loras / lora_keys / actualLoras (and their nested assets).
 */
export function validateAbRequestHashInputDiff(aInput: unknown, bInput: unknown): AttemptIntegrityIssue[] {
    if (!isPlainObject(aInput) || !isPlainObject(bInput)) {
        return [{ code: "ab_not_object", message: "both inputs must be plain objects" }];
    }
    return collectDisallowedAbDiff(aInput, bInput, "");
}

export type U1R0FrozenManifestCell = {
    cellId: string;
    direction: string;
    seed: number;
    group: string;
    requestSha256?: unknown;
    requestHashInput?: unknown;
    requestHashInputJcsUtf8Base64?: unknown;
};

export type U1R0FrozenManifestLike = {
    status?: unknown;
    matrix?: {
        directions?: unknown;
        seeds?: unknown;
        groups?: unknown;
        plannedCells?: unknown;
        plannedPairs?: unknown;
    };
    model?: unknown;
    groupA?: { loras?: unknown };
    groupB?: { loras?: unknown };
    promptsByDirection?: unknown;
    sampling?: unknown;
    artifactsByDirection?: unknown;
    workflow?: unknown;
    mutators?: unknown;
    plannedCells?: U1R0FrozenManifestCell[];
};

/**
 * Semantic FROZEN gate beyond JSON Schema:
 * - planned cellId/direction/seed/group match first-round matrix exactly
 * - requestHashInput shape + hash/base64 consistency
 * - cell fields align with requestHashInput and top-level frozen values
 * - group A uses frozen 6 LoRAs; group B empty; A/B pairs actually differ on LoRA
 */
export function validateFrozenManifestSemantics(manifest: U1R0FrozenManifestLike): AttemptIntegrityIssue[] {
    if (manifest.status !== "FROZEN") {
        return [{ code: "not_frozen", message: String(manifest.status) }];
    }
    const issues: AttemptIntegrityIssue[] = [];
    const expectedCells = buildFirstRoundPlannedCells();
    const cells = Array.isArray(manifest.plannedCells) ? manifest.plannedCells : [];
    if (cells.length !== 18) {
        issues.push({ code: "planned_cells_count", message: String(cells.length) });
    }

    const matrix = isPlainObject(manifest.matrix) ? manifest.matrix : null;
    if (!matrix) {
        issues.push({ code: "matrix_missing", message: "matrix" });
    } else {
        if (canonicalizeJson(matrix.directions) !== canonicalizeJson([...U1_R0_DIRECTIONS])) {
            issues.push({ code: "matrix_directions", message: "expected up/down/outward" });
        }
        if (canonicalizeJson(matrix.seeds) !== canonicalizeJson([...U1_R0_SEEDS])) {
            issues.push({ code: "matrix_seeds", message: "expected fixed first-round seeds" });
        }
        if (canonicalizeJson(matrix.groups) !== canonicalizeJson([...U1_R0_GROUPS])) {
            issues.push({ code: "matrix_groups", message: "expected A/B" });
        }
        if (matrix.plannedCells !== 18) issues.push({ code: "matrix_planned_cells", message: String(matrix.plannedCells) });
        if (matrix.plannedPairs !== 9) issues.push({ code: "matrix_planned_pairs", message: String(matrix.plannedPairs) });
    }

    const groupALoras = Array.isArray(manifest.groupA?.loras) ? manifest.groupA!.loras : null;
    const groupBLoras = Array.isArray(manifest.groupB?.loras) ? manifest.groupB!.loras : null;
    if (!groupALoras || groupALoras.length !== 6) {
        issues.push({ code: "group_a_loras", message: "expected 6 frozen loras" });
    }
    if (!groupBLoras || groupBLoras.length !== 0) {
        issues.push({ code: "group_b_loras", message: "expected empty loras" });
    }

    const expectedById = new Map(expectedCells.map((cell) => [cell.cellId, cell]));
    const byId = new Map<string, U1R0FrozenManifestCell>();
    const seenIds = new Set<string>();

    for (const cell of cells) {
        if (seenIds.has(cell.cellId)) {
            issues.push({ code: "duplicate_cell_id", message: cell.cellId });
        }
        seenIds.add(cell.cellId);
        byId.set(cell.cellId, cell);

        const expected = expectedById.get(cell.cellId);
        if (!expected) {
            issues.push({ code: "unknown_cell_id", message: cell.cellId });
            continue;
        }
        if (cell.direction !== expected.direction || cell.seed !== expected.seed || cell.group !== expected.group) {
            issues.push({
                code: "cell_identity_mismatch",
                message: `${cell.cellId}: expected ${expected.direction}/${expected.seed}/${expected.group}`,
            });
            continue;
        }

        const input = cell.requestHashInput;
        if (!isPlainObject(input)) {
            issues.push({ code: "cell_hash_input_missing", message: cell.cellId });
            continue;
        }
        if (input.spec !== U1_R0_REQUEST_HASH_SPEC) {
            issues.push({ code: "cell_hash_spec", message: cell.cellId });
        }
        const execution = isPlainObject(input.execution) ? input.execution : null;
        const inputs = isPlainObject(input.inputs) ? input.inputs : null;
        if (!execution || !inputs) {
            issues.push({ code: "cell_hash_input_shape", message: cell.cellId });
            continue;
        }
        if (execution.direction !== expected.direction) {
            issues.push({ code: "cell_direction_mismatch", message: cell.cellId });
        }
        if (execution.seed !== expected.seed) {
            issues.push({ code: "cell_seed_mismatch", message: cell.cellId });
        }

        const loras = Array.isArray(execution.loras) ? execution.loras : null;
        if (expected.group === "A") {
            if (!loras || !groupALoras || canonicalizeJson(loras) !== canonicalizeJson(groupALoras)) {
                issues.push({ code: "cell_group_a_loras_mismatch", message: cell.cellId });
            }
        } else if (expected.group === "B") {
            if (!loras || loras.length !== 0) {
                issues.push({ code: "cell_group_b_loras_mismatch", message: cell.cellId });
            }
        }

        issues.push(...validateCellAgainstTopLevel(cell.cellId, expected.direction, execution, inputs, manifest));

        try {
            const projected = requestSha256FromHashInput(input);
            if (cell.requestSha256 !== projected.requestSha256) {
                issues.push({ code: "cell_request_sha_mismatch", message: cell.cellId });
            }
            if (cell.requestHashInputJcsUtf8Base64 !== projected.jcsUtf8Base64) {
                issues.push({ code: "cell_request_jcs_mismatch", message: cell.cellId });
            }
        } catch (error) {
            issues.push({
                code: "cell_hash_projection_error",
                message: `${cell.cellId}:${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    for (const expected of expectedCells) {
        if (!byId.has(expected.cellId)) {
            issues.push({ code: "missing_cell_id", message: expected.cellId });
        }
    }

    for (const slot of buildFirstRoundPairSlots()) {
        const a = byId.get(slot.aCellId);
        const b = byId.get(slot.bCellId);
        if (!a || !b) {
            issues.push({ code: "pair_cell_missing", message: slot.pairId });
            continue;
        }
        for (const issue of validateAbRequestHashInputDiff(a.requestHashInput, b.requestHashInput)) {
            issues.push({ code: issue.code, message: `${slot.pairId}:${issue.message}` });
        }
        // A/B must actually differ on LoRA payload (A non-empty recipe vs B empty)
        const aExec = isPlainObject(a.requestHashInput) && isPlainObject((a.requestHashInput as Record<string, unknown>).execution)
            ? ((a.requestHashInput as Record<string, unknown>).execution as Record<string, unknown>)
            : null;
        const bExec = isPlainObject(b.requestHashInput) && isPlainObject((b.requestHashInput as Record<string, unknown>).execution)
            ? ((b.requestHashInput as Record<string, unknown>).execution as Record<string, unknown>)
            : null;
        const aLoras = Array.isArray(aExec?.loras) ? aExec!.loras : null;
        const bLoras = Array.isArray(bExec?.loras) ? bExec!.loras : null;
        if (!aLoras || aLoras.length !== 6 || !bLoras || bLoras.length !== 0) {
            issues.push({ code: "pair_lora_contrast", message: slot.pairId });
        } else if (canonicalizeJson(a.requestHashInput) === canonicalizeJson(b.requestHashInput)) {
            issues.push({ code: "pair_identical_request", message: slot.pairId });
        }
    }

    return issues;
}

function validateCellAgainstTopLevel(
    cellId: string,
    direction: string,
    execution: Record<string, unknown>,
    inputs: Record<string, unknown>,
    manifest: U1R0FrozenManifestLike,
): AttemptIntegrityIssue[] {
    const issues: AttemptIntegrityIssue[] = [];
    const model = isPlainObject(manifest.model) ? manifest.model : null;
    const sampling = isPlainObject(manifest.sampling) ? manifest.sampling : null;
    const workflow = isPlainObject(manifest.workflow) ? manifest.workflow : null;
    const promptsRoot = isPlainObject(manifest.promptsByDirection) ? manifest.promptsByDirection : null;
    const artifactsRoot = isPlainObject(manifest.artifactsByDirection) ? manifest.artifactsByDirection : null;
    const prompts = promptsRoot && isPlainObject(promptsRoot[direction]) ? (promptsRoot[direction] as Record<string, unknown>) : null;
    const artifacts = artifactsRoot && isPlainObject(artifactsRoot[direction]) ? (artifactsRoot[direction] as Record<string, unknown>) : null;
    const execModel = isPlainObject(execution.model) ? execution.model : null;
    const execWorkflow = isPlainObject(execution.workflow) ? execution.workflow : null;

    if (model && execModel) {
        if (execModel.capabilityId !== model.capabilityId || execModel.checkpointId !== model.checkpointId || execModel.sha256 !== model.sha256) {
            issues.push({ code: "cell_model_mismatch", message: cellId });
        }
    } else {
        issues.push({ code: "cell_model_missing", message: cellId });
    }

    if (sampling) {
        if (execution.sampler !== sampling.sampler || execution.scheduler !== sampling.scheduler || execution.steps !== sampling.steps || execution.cfg !== sampling.cfg) {
            issues.push({ code: "cell_sampling_mismatch", message: cellId });
        }
        const denoiseMap = isPlainObject(sampling.denoiseByDirection) ? sampling.denoiseByDirection : null;
        const seamMap = isPlainObject(sampling.seamByDirection) ? sampling.seamByDirection : null;
        const extensionMap = isPlainObject(sampling.extensionRatioByDirection) ? sampling.extensionRatioByDirection : null;
        if (!denoiseMap || execution.denoise !== denoiseMap[direction]) issues.push({ code: "cell_denoise_mismatch", message: cellId });
        if (!seamMap || execution.seam !== seamMap[direction]) issues.push({ code: "cell_seam_mismatch", message: cellId });
        if (!extensionMap || execution.extensionRatio !== extensionMap[direction]) issues.push({ code: "cell_extension_mismatch", message: cellId });
    } else {
        issues.push({ code: "cell_sampling_missing", message: cellId });
    }

    if (workflow && execWorkflow) {
        if (execWorkflow.bindingId !== workflow.bindingId || execWorkflow.version !== workflow.version || execWorkflow.sha256 !== workflow.sha256) {
            issues.push({ code: "cell_workflow_mismatch", message: cellId });
        }
    } else {
        issues.push({ code: "cell_workflow_missing", message: cellId });
    }

    if (Array.isArray(manifest.mutators)) {
        if (canonicalizeJson(execution.mutators) !== canonicalizeJson(manifest.mutators.map((item) => {
            if (!isPlainObject(item)) return item;
            return { id: item.id, version: item.version };
        }))) {
            issues.push({ code: "cell_mutators_mismatch", message: cellId });
        }
    }

    if (prompts) {
        if (canonicalizeJson(inputs.positive) !== canonicalizeJson(prompts.positive) || canonicalizeJson(inputs.negative) !== canonicalizeJson(prompts.negative)) {
            issues.push({ code: "cell_prompt_mismatch", message: cellId });
        }
    } else {
        issues.push({ code: "cell_prompt_missing", message: cellId });
    }

    if (artifacts) {
        const base = isPlainObject(artifacts.base) ? artifacts.base : null;
        const pad = isPlainObject(artifacts.pad) ? artifacts.pad : null;
        const mask = isPlainObject(artifacts.mask) ? artifacts.mask : null;
        const inBase = isPlainObject(inputs.base) ? inputs.base : null;
        const inPad = isPlainObject(inputs.pad) ? inputs.pad : null;
        const inMask = isPlainObject(inputs.mask) ? inputs.mask : null;
        if (!base || !pad || !mask || !inBase || !inPad || !inMask
            || inBase.sha256 !== base.sha256
            || inPad.sha256 !== pad.sha256
            || inMask.sha256 !== mask.sha256) {
            issues.push({ code: "cell_artifact_mismatch", message: cellId });
        }
        const dimensions = isPlainObject(execution.dimensions) ? execution.dimensions : null;
        const targetWidth = artifacts.targetWidth;
        const targetHeight = artifacts.targetHeight;
        if (
            typeof targetWidth !== "number"
            || !Number.isInteger(targetWidth)
            || targetWidth < 1
            || typeof targetHeight !== "number"
            || !Number.isInteger(targetHeight)
            || targetHeight < 1
        ) {
            issues.push({ code: "cell_target_size_missing", message: cellId });
        } else if (!dimensions || dimensions.width !== targetWidth || dimensions.height !== targetHeight) {
            issues.push({ code: "cell_dimensions_mismatch", message: cellId });
        }
    } else {
        issues.push({ code: "cell_artifact_missing", message: cellId });
    }

    return issues;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectDisallowedAbDiff(a: unknown, b: unknown, path: string): AttemptIntegrityIssue[] {
    if (Object.is(a, b)) return [];
    if (isPlainObject(a) && isPlainObject(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        const issues: AttemptIntegrityIssue[] = [];
        for (const key of keys) {
            const nextPath = path ? `${path}.${key}` : key;
            if (AB_DIFF_ALLOWED.has(key)) continue;
            issues.push(...collectDisallowedAbDiff(a[key], b[key], nextPath));
        }
        return issues;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return [{ code: "ab_diff_disallowed_key", message: path || "(root)" }];
        }
        const issues: AttemptIntegrityIssue[] = [];
        for (let i = 0; i < a.length; i += 1) {
            issues.push(...collectDisallowedAbDiff(a[i], b[i], `${path}[${i}]`));
        }
        return issues;
    }
    return [{ code: "ab_diff_disallowed_key", message: path || "(root)" }];
}
