import { create } from "zustand";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; url: string; dataUrl: string };
export type AgentChatItem = { id: string; role: AgentChatRole; title?: string; text: string; meta?: string; detail?: unknown; attachments?: AgentAttachment[]; streamId?: string };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[] } };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentPanelTab = "chat" | "setup" | "history" | "log";

const CONNECT_TIMEOUT_MS = 6000;
let agentSource: EventSource | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

type AgentStatePatch = Partial<Omit<CanvasAgentStore, "setAgentState" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs">>;

type CanvasAgentStore = {
    width: number;
    url: string;
    token: string;
    /** 画布工具桥已就绪（真实 SSE，可执行 canvas_* 工具） */
    connected: boolean;
    /** Canvas Agent HTTP 在线（status 探测，不等于可写画布） */
    agentOnline: boolean;
    enabled: boolean;
    prompt: string;
    agentModel: string;
    attachments: AgentAttachment[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    confirmTools: boolean;
    activity: string;
    connectError: string;
    pendingTool: AgentPendingToolCall | null;
    setAgentState: (patch: AgentStatePatch) => void;
    connectAgent: () => void;
    disconnectAgent: (patch?: AgentStatePatch) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

function readConfirmTools() {
    if (typeof window === "undefined") return false;
    const value = localStorage.getItem("canvas-agent-confirm-tools");
    if (value === null) return false;
    return value === "true";
}

export const useCanvasAgentStore = create<CanvasAgentStore>((set, get) => ({
    width: typeof window === "undefined" ? 440 : Number(localStorage.getItem("canvas-agent-panel-width")) || 440,
    url: typeof window === "undefined" ? "http://127.0.0.1:17371" : localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371",
    token: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-token") || "",
    connected: false,
    agentOnline: false,
    enabled: false,
    prompt: "",
    agentModel: (() => {
        if (typeof window === "undefined") return "gpt-5.5";
        const saved = localStorage.getItem("canvas-agent-model") || "gpt-5.5";
        // Grok 目前无法稳定调用画布 MCP 工具，默认回退 gpt-5.5
        if (/^grok/i.test(saved)) return "gpt-5.5";
        return saved;
    })(),
    attachments: [],
    sending: false,
    waiting: false,
    messages: [],
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "setup",
    confirmTools: readConfirmTools(),
    activity: "就绪",
    connectError: "",
    pendingTool: null,
    setAgentState: (patch) => {
        if (typeof patch.confirmTools === "boolean" && typeof window !== "undefined") {
            localStorage.setItem("canvas-agent-confirm-tools", patch.confirmTools ? "true" : "false");
        }
        if (typeof patch.url === "string" && typeof window !== "undefined") localStorage.setItem("canvas-agent-url", patch.url);
        if (typeof patch.token === "string" && typeof window !== "undefined") localStorage.setItem("canvas-agent-token", patch.token);
        if (typeof patch.agentModel === "string" && typeof window !== "undefined") localStorage.setItem("canvas-agent-model", patch.agentModel);
        set(patch);
    },
    connectAgent: () => {
        const endpoint = get().url.trim().replace(/\/$/, "");
        const token = get().token.trim();
        if (!endpoint || !token) return set({ connectError: "请填写 Local URL 和 Connect token" });
        try {
            const parsed = new URL(endpoint);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        } catch {
            return set({ connectError: "Local URL 格式不正确" });
        }
        get().disconnectAgent({ url: endpoint, token, enabled: true, activity: "探测 Agent…", connectError: "" });
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        const clientId = typeof crypto === "undefined" ? `${Date.now()}` : crypto.randomUUID();
        const source = new EventSource(`${endpoint}/events?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}&role=status`);
        agentSource = source;
        connectTimer = setTimeout(() => {
            if (agentSource !== source) return;
            get().disconnectAgent({ activity: "连接超时", connectError: "连接超时：请确认 Canvas Agent 正在运行，并使用当前启动输出的 Connect token" });
        }, CONNECT_TIMEOUT_MS);
        source.addEventListener("hello", () => {
            if (connectTimer) clearTimeout(connectTimer);
            connectTimer = null;
            // status 探测只表示 Agent 在线，不代表画布工具桥已就绪
            set({ enabled: true, agentOnline: true, activity: "Agent 在线", connectError: "" });
        });
        source.onerror = () => {
            if (agentSource === source) get().disconnectAgent({ activity: "连接失败", connectError: "连接失败：请检查 Local URL、Connect token 或已绑定的网页 Origin" });
        };
    },
    disconnectAgent: (patch = {}) => {
        agentSource?.close();
        agentSource = null;
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        set({ enabled: false, connected: false, agentOnline: false, activity: "离线", ...patch });
    },
    addMessage: (item) => set((state) => ({ messages: [...state.messages.slice(-120), item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
