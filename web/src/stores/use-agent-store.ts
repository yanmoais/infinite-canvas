import { create } from "zustand";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; url: string; dataUrl: string };
export type AgentChatItem = { id: string; role: AgentChatRole; title?: string; text: string; meta?: string; detail?: unknown; attachments?: AgentAttachment[]; streamId?: string };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[]; path?: string } & Record<string, unknown> };
export type AgentCanvasContext = { snapshot: CanvasAgentSnapshot; applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot; undoOps: () => CanvasAgentSnapshot | null; canUndo: boolean };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentPanelTab = "chat" | "setup" | "history" | "log";

type AgentStatePatch = Partial<
    Omit<AgentStore, "setAgentState" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">
>;

type AgentStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    canvasContext: AgentCanvasContext | null;
    url: string;
    token: string;
    /** 画布工具桥已就绪（真实 SSE，可执行 canvas_* 工具） */
    connected: boolean;
    /** Canvas Agent HTTP 在线（status 探测，不等于可写画布） */
    agentOnline: boolean;
    enabled: boolean;
    silentConnect: boolean;
    prompt: string;
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
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    connectAgent: (options?: { silent?: boolean }) => void;
    disconnectAgent: (patch?: AgentStatePatch) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

function readConfirmTools() {
    if (typeof window === "undefined") return false;
    const value = localStorage.getItem("canvas-agent-confirm-tools");
    if (value === null) return false; // 二开默认关闭，避免 MCP 写画布卡在确认
    return value === "true";
}

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: typeof window === "undefined" ? 440 : Number(localStorage.getItem("canvas-agent-panel-width")) || 440,
    panelOpen: false,
    panelMounted: true,
    panelClosing: false,
    canvasContext: null,
    url: typeof window === "undefined" ? "http://127.0.0.1:17371" : localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371",
    token: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-token") || "",
    connected: false,
    agentOnline: false,
    enabled: false,
    silentConnect: false,
    prompt: "",
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
        set(patch);
    },
    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    connectAgent: (options) => {
        const silent = options?.silent ?? false;
        const endpoint = get().url.trim().replace(/\/$/, "");
        const token = get().token.trim();
        if (!endpoint || !token) return set({ connectError: silent ? "" : "请填写 Local URL 和 Connect token" });
        try {
            const parsed = new URL(endpoint);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        } catch {
            return set({ connectError: silent ? "" : "Local URL 格式不正确" });
        }
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        // 只设 enabled=true，由 CanvasLocalAgentPanel 的 useEffect 统一负责开 SSE
        set({ url: endpoint, token, enabled: true, silentConnect: silent, activity: "连接中", connectError: "" });
    },
    disconnectAgent: (patch = {}) => {
        set({ enabled: false, connected: false, agentOnline: false, silentConnect: false, activity: "离线", ...patch });
    },
    addMessage: (item) => set((state) => ({ messages: [...state.messages.slice(-120), item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
