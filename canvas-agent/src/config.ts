import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
export const CONFIG_DIR = path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = [
    "你正在帮助用户操作 Infinite Canvas 网页画布。",
    "",
    "最高优先级：",
    "- 你已经处于画布 Agent 会话中；画布网页和本地 Canvas Agent 已连接。",
    "- 操作画布时必须直接调用 infinite-canvas 的 MCP tools（canvas_*）。",
    "- 禁止读取 skills、SKILL.md、plugin 文档、本地文件、package.json 或 README 来“寻找工具”。",
    "- 禁止运行 shell / python / 命令行去探测工具、配置或工作区。",
    "- 禁止说“没有工具”后改用 shell；工具不可用时只简短说明并停止。",
    "",
    "硬性禁止：",
    "- 不要调用 MCP resources/read、resources/list、resources/templates/list。",
    "- 不要访问 canvas://state 或任何 MCP resource URI。",
    "- Infinite Canvas MCP 只提供 tools，不提供 resources API。",
    "- 不要调用 open-canvas / canvas 技能；不要尝试重新打开画布。",
    "- 不要用 tool_search 替代直接调用 canvas_* 工具。",
    "",
    "读取与操作规则：",
    "- 读取当前画布状态必须且只能调用工具 canvas_get_state。",
    "- 读取当前选区必须且只能调用工具 canvas_get_selection。",
    "- 创建单个文本节点用 canvas_create_text_node。",
    "- 需要改动画布时，根据任务使用 canvas_create_text_node、canvas_generate_text、canvas_generate_image、canvas_generate_video、canvas_generate_audio、canvas_create_generation_flow、canvas_create_config_node、canvas_run_generation、canvas_update_node、canvas_connect_nodes 等工具。",
    "- 复杂批量改动再用 canvas_apply_ops，删除连线可用 delete_connections。",
    "- 需要生成内容时直接调用对应生成工具，不要绑定特定业务场景。",
    "- 不要模拟鼠标点击，不要要求用户手动复制 JSON。",
    "- 调用工具前不要先解释计划；直接调用工具，再用一句话汇报结果。",
].join("\n");

export type CanvasWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type CanvasAgentConfig = { url: string; token: string; origins?: string[]; canvases?: Record<string, CanvasWorkspaceConfig> };

export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

export function saveConfig(config: CanvasAgentConfig) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function ensureCanvasWorkspace(config: CanvasAgentConfig, canvasId: string) {
    const id = safeSegment(canvasId || "default");
    config.canvases ||= {};
    const current = config.canvases[id];
    if (current?.workspacePath) {
        const resolved = resolveWorkspacePath(current.workspacePath);
        fs.mkdirSync(resolved, { recursive: true });
        writeWorkspaceAgentsMd(resolved);
        return { canvasId: id, ...current, workspacePath: resolved };
    }
    const workspacePath = path.join(CONFIG_DIR, "codex-workspaces", id);
    config.canvases[id] = { workspacePath };
    fs.mkdirSync(workspacePath, { recursive: true });
    writeWorkspaceAgentsMd(workspacePath);
    saveConfig(config);
    return { canvasId: id, workspacePath };
}

export function updateCanvasWorkspace(config: CanvasAgentConfig, canvasId: string, patch: Partial<CanvasWorkspaceConfig>) {
    const current = ensureCanvasWorkspace(config, canvasId);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next = { ...current, ...patch, workspacePath };
    config.canvases ||= {};
    config.canvases[current.canvasId] = { workspacePath: next.workspacePath, activeThreadId: next.activeThreadId, pinnedThreadIds: next.pinnedThreadIds };
    fs.mkdirSync(workspacePath, { recursive: true });
    saveConfig(config);
    return { canvasId: current.canvasId, ...config.canvases[current.canvasId] };
}

function resolveWorkspacePath(value: string) {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return path.resolve(value);
}


function writeWorkspaceAgentsMd(workspacePath: string) {
    const target = path.join(workspacePath, "AGENTS.md");
    if (fs.existsSync(target)) return;
    fs.writeFileSync(
        target,
        [
            "# Infinite Canvas Agent Workspace Rules",
            "",
            "You are inside an Infinite Canvas local agent workspace.",
            "",
            "## Hard rules",
            "- Operate the canvas only through infinite-canvas MCP tools: `canvas_get_state`, `canvas_get_selection`, `canvas_create_text_node`, `canvas_apply_ops`, and other `canvas_*` tools.",
            "- Do NOT run shell, python, or any command to discover tools or open files.",
            "- Do NOT read `SKILL.md`, plugin docs, package.json, README, or local files for tool discovery.",
            "- Do NOT call MCP resources APIs. Tools only.",
            "- Do NOT use `tool_search` as a substitute for calling `canvas_*` tools.",
            "- If `canvas_*` tools are unavailable, report that briefly and stop.",
            "",
            "## Workflow",
            "1. Read with `canvas_get_state` / `canvas_get_selection`.",
            "2. Mutate with `canvas_create_text_node` or other canvas tools.",
            "3. Reply with one short Chinese confirmation after tool results.",
            "",
        ].join("\n"),
    );
}

function safeSegment(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "default";
}

function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
