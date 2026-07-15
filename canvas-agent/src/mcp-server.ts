import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AGENT_PROMPT, loadConfig, type CanvasAgentConfig, VERSION } from "./config.js";
import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "./schemas.js";

type CanvasAgentToolResponse = { ok?: boolean; result?: unknown; error?: string };

export async function startMcpServer() {
    const config = loadConfig(true);
    await ensureHttpAgentRunning(config);
    const server = new McpServer({ name: "canvas-agent", version: VERSION }, { instructions: AGENT_PROMPT });
    toolNames.forEach((name) => registerCanvasTool(server, config, name));
    await server.connect(new StdioServerTransport());
}

function registerCanvasTool(server: McpServer, config: CanvasAgentConfig, name: ToolName) {
    const schema = toolInputSchemas[name];
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: schema.shape }, async (input: unknown) => {
        const result = await postCanvasAgentTool(config, name, schema.parse(input));
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}

async function postCanvasAgentTool(config: CanvasAgentConfig, name: ToolName, input: unknown) {
    let res: Response;
    try {
        res = await fetch(`${config.url}/api/tools`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-canvas-agent-token": config.token },
            body: JSON.stringify({ name, input }),
        });
    } catch (error) {
        throw new Error(`无法连接 Canvas Agent（${config.url}）。请先启动：npx -y @basketikun/canvas-agent。原始错误：${error instanceof Error ? error.message : String(error)}`);
    }
    let body: CanvasAgentToolResponse;
    try {
        body = (await res.json()) as CanvasAgentToolResponse;
    } catch {
        throw new Error(`Canvas Agent 返回了无法解析的响应（HTTP ${res.status}）`);
    }
    if (!body.ok) throw new Error(body.error || `tool call failed (HTTP ${res.status})`);
    return body.result;
}

async function ensureHttpAgentRunning(config: CanvasAgentConfig) {
    if (await isAgentHealthy(config.url)) return;
    const entry = fileURLToPath(new URL("./index.js", import.meta.url));
    try {
        const child = spawn(process.execPath, [entry], {
            detached: true,
            stdio: "ignore",
            env: process.env,
            windowsHide: true,
        });
        child.unref();
    } catch {
        // 启动失败时继续，工具调用会给出明确错误
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (await isAgentHealthy(config.url)) return;
        await sleep(250);
    }
}

async function isAgentHealthy(url: string) {
    try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        return res.ok;
    } catch {
        return false;
    }
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
