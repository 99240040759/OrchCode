import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import * as api from "./api";
import { newId } from "./utils";
import type { ModelDto, Budget, WorkspaceInfo, SessionSummary, ToolDisplayInfo, MessageItemView, AttachmentRef } from "./api";

type ReasoningEffort = "low" | "medium" | "high";

let sessionsListenerBound = false;
let modelsListenerBound = false;

export interface ReasoningItem {
  type: "reasoning";
  id: string;
  text: string;
  active: boolean;
  startTime: number;
  durationSeconds?: number;
}

export interface ToolCallItem {
  type: "toolCall";
  id: string;
  name: string;
  args: string;
  displayInfo: ToolDisplayInfo;
  output?: string;
  status: "running" | "done" | "error";
}

export interface TextItem {
  type: "text";
  id: string;
  text: string;
}

export interface CompactionNoticeItem {
  type: "compactionNotice";
  id: string;
  originalMessageCount: number;
  ts: number;
}

export type MessageItem = ReasoningItem | ToolCallItem | TextItem | CompactionNoticeItem;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  items: MessageItem[];
  attachments?: AttachmentRef[];
  streaming?: boolean;
  error?: string;
  usage?: TokenUsage;
}

function viewItemToLocal(item: MessageItemView): MessageItem {
  if (item.type === "text") return { type: "text", id: item.id, text: item.text };
  if (item.type === "reasoning") return { type: "reasoning", id: item.id, text: item.text, active: false, startTime: 0 };
  if (item.type === "compactionNotice") {
    return { type: "compactionNotice", id: item.id, originalMessageCount: item.originalMessageCount, ts: item.ts };
  }
  return {
    type: "toolCall",
    id: item.id,
    name: item.name,
    args: item.args,
    displayInfo: item.displayInfo ?? { label: item.name || "Tool", icon: "terminal", opensArtifact: false },
    output: item.output,
    status: item.status as "running" | "done" | "error",
  };
}

interface ChatState {
  sessions: SessionSummary[];
  currentSessionId: string;
  sessionGeneration: number;
  messages: ChatMessage[];
  streaming: boolean;
  sessionTokens: TokenUsage;
  models: ModelDto[];
  selectedModel: ModelDto | null;
  reasoningEffort: ReasoningEffort;
  budget: Budget | null;
  workspace: WorkspaceInfo | null;
  error: string | null;
}

interface ChatActions {
  initialize: () => Promise<void>;
  newChat: () => void;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  send: (prompt: string, attachments?: AttachmentRef[]) => Promise<void>;
  cancel: () => void;
  setSelectedModel: (key: string) => Promise<void>;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  pickWorkspace: () => Promise<void>;
  resetToSandbox: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshBudget: () => Promise<void>;
  refreshModels: () => Promise<void>;
}

export type ChatStore = ChatState & ChatActions;

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export const useChatStore = create(
  immer<ChatStore>((set, get) => ({
    sessions: [],
    currentSessionId: newId(),
    sessionGeneration: 0,
    messages: [],
    streaming: false,
    sessionTokens: ZERO_USAGE,
    models: [],
    selectedModel: null,
    reasoningEffort: "medium",
    budget: null,
    workspace: null,
    error: null,

    initialize: async () => {
      const [sessions, workspace, models] = await Promise.allSettled([
        api.listSessions(),
        api.getWorkspaceInfo(),
        api.listModels(),
      ]);
      const [savedModelKey, savedEffort] = await Promise.all([
        api.getUserPref("selectedModel").catch(() => null),
        api.getUserPref("reasoningEffort").catch(() => null),
      ]);
      set((s) => {
        if (sessions.status === "fulfilled") s.sessions = sessions.value;
        if (workspace.status === "fulfilled") s.workspace = workspace.value;
        if (models.status === "fulfilled") {
          s.models = models.value;
          const preferred = typeof savedModelKey === "string"
            ? models.value.find((m) => m.key === savedModelKey)
            : undefined;
          s.selectedModel = preferred ?? models.value[0] ?? null;
        }
        if (savedEffort === "low" || savedEffort === "medium" || savedEffort === "high") {
          s.reasoningEffort = savedEffort;
        }
      });
      api.getBudget().then((b) => {
        if (b) set((s) => { s.budget = b; });
      }).catch(() => {});

      if (api.inTauri() && !sessionsListenerBound) {
        sessionsListenerBound = true;
        import("@tauri-apps/api/event").then(({ listen }) => {
          listen("sessions-updated", () => {
            get().refreshSessions();
          });
        }).catch(() => { sessionsListenerBound = false; });
      }

      if (api.inTauri() && !modelsListenerBound) {
        modelsListenerBound = true;
        import("@tauri-apps/api/event").then(({ listen }) => {
          listen("models-updated", () => {
            get().refreshModels();
          });
        }).catch(() => { modelsListenerBound = false; });
      }
    },

    newChat: () => {
      if (get().streaming) return;
      set((s) => {
        s.currentSessionId = newId();
        s.sessionGeneration += 1;
        s.messages = [];
        s.sessionTokens = ZERO_USAGE;
        s.error = null;
      });
    },

    selectSession: async (id: string) => {
      if (get().streaming) return;
      const targetSession = get().sessions.find((s) => s.id === id);
      set((s) => {
        s.currentSessionId = id;
        s.sessionGeneration += 1;
        s.messages = [];
        s.sessionTokens = targetSession
          ? { inputTokens: targetSession.lastInputTokens, outputTokens: targetSession.lastOutputTokens, totalTokens: targetSession.lastTotalTokens }
          : ZERO_USAGE;
        s.error = null;
      });
      if (targetSession?.workspacePath && api.inTauri()) {
        api.setWorkspace(targetSession.workspacePath).then((info) => {
          set((s) => { s.workspace = info; });
        }).catch(() => {});
      }
      try {
        const views = await api.getSessionView(id);
        set((s) => {
          if (s.currentSessionId !== id) return;
          s.messages = views.map((v) => ({
            id: v.id,
            role: v.role as ChatMessage["role"],
            items: v.items.map(viewItemToLocal),
            attachments: v.attachments && v.attachments.length > 0
              ? v.attachments.map((a) => ({ path: a.dataUrl || a.name, name: a.name, isImage: a.isImage }))
              : undefined,
            streaming: false,
          }));
        });
      } catch (e) {
        set((s) => {
          if (s.currentSessionId === id) {
            s.error = e instanceof Error ? e.message : String(e);
          }
        });
      }
    },

    deleteSession: async (id: string) => {
      if (get().streaming && get().currentSessionId === id) {
        api.cancelChat(id).catch(() => {});
        await new Promise((r) => setTimeout(r, 300));
      }
      await api.clearSession(id);
      set((s) => {
        s.sessions = s.sessions.filter((sess) => sess.id !== id);
        if (s.currentSessionId === id) {
          s.currentSessionId = newId();
          s.sessionGeneration += 1;
          s.messages = [];
          s.sessionTokens = ZERO_USAGE;
          s.streaming = false;
          s.error = null;
        }
      });
    },

    send: async (prompt: string, attachments?: AttachmentRef[]) => {
      const { streaming, currentSessionId, selectedModel, reasoningEffort } = get();
      const text = prompt.trim();
      const hasAttachments = !!attachments && attachments.length > 0;
      if ((!text && !hasAttachments) || streaming) return;

      const userMsgId = newId();
      const assistantMsgId = newId();
      const sessionIdAtSend = currentSessionId;

      set((s) => {
        s.error = null;
        s.streaming = true;
        s.messages.push({
          id: userMsgId,
          role: "user",
          items: [{ type: "text", id: newId(), text }],
          attachments: hasAttachments ? attachments : undefined,
        });
        s.messages.push({ id: assistantMsgId, role: "assistant", items: [], streaming: true });
      });

      const patch = (fn: (m: ChatMessage) => void) => {
        set((s) => {
          if (s.currentSessionId !== sessionIdAtSend) return;
          const msg = s.messages.find((m) => m.id === assistantMsgId);
          if (msg) fn(msg);
        });
      };

      const finishStreaming = () => {
        set((s) => {
          if (s.currentSessionId === sessionIdAtSend) s.streaming = false;
        });
      };

      try {
        await api.startChat(sessionIdAtSend, selectedModel?.key ?? "", text, reasoningEffort, attachments, (raw: unknown) => {
          const e = raw as {
            type: string;
            delta?: string;
            id?: string;
            name?: string;
            args?: string;
            displayInfo?: ToolDisplayInfo;
            output?: string;
            message?: string;
            durationSeconds?: number;
            originalMessageCount?: number;
            ts?: number;
          };
          switch (e.type) {
            case "text": {
              patch((m) => {
                const last = m.items[m.items.length - 1];
                if (last?.type === "text") last.text += e.delta ?? "";
                else m.items.push({ type: "text", id: newId(), text: e.delta ?? "" });
              });
              break;
            }
            case "reasoning": {
              patch((m) => {
                const last = m.items[m.items.length - 1];
                if (last?.type === "reasoning" && last.active) last.text += e.delta ?? "";
                else m.items.push({ type: "reasoning", id: newId(), text: e.delta ?? "", active: true, startTime: Date.now() });
              });
              break;
            }
            case "reasoningDone": {
              patch((m) => {
                for (let i = m.items.length - 1; i >= 0; i--) {
                  const it = m.items[i];
                  if (it.type === "reasoning" && it.active) {
                    it.active = false;
                    it.durationSeconds = e.durationSeconds ?? Math.max(1, Math.round((Date.now() - it.startTime) / 1000));
                    break;
                  }
                }
              });
              break;
            }
            case "toolCall": {
              const info = e.displayInfo ?? { label: e.name ?? "Tool", icon: "terminal", opensArtifact: false };
              patch((m) => {
                m.items.push({
                  type: "toolCall",
                  id: e.id!,
                  name: e.name!,
                  args: e.args!,
                  displayInfo: info,
                  status: "running",
                });
              });
              if (info.opensArtifact && info.icon === "globe" && info.targetText) {
                import("./artifacts").then(({ useArtifactsStore }) => {
                  useArtifactsStore.getState().openBrowser(info.targetText!);
                }).catch(() => {});
              }
              break;
            }
            case "toolResult": {
              const tre = e as { type: string; id: string; output: string; isError?: boolean };
              patch((m) => {
                const item = m.items.find((i): i is ToolCallItem => i.type === "toolCall" && i.id === tre.id);
                if (item) {
                  item.output = tre.output;
                  item.status = tre.isError ? "error" : "done";
                }
              });
              break;
            }
            case "usage": {
              const ue = e as { type: string; inputTokens?: number; outputTokens?: number; totalTokens?: number };
              const usage: TokenUsage = {
                inputTokens: ue.inputTokens ?? 0,
                outputTokens: ue.outputTokens ?? 0,
                totalTokens: ue.totalTokens ?? 0,
              };
              patch((m) => { m.usage = usage; });
              set((s) => {
                if (s.currentSessionId === sessionIdAtSend) s.sessionTokens = usage;
              });
              break;
            }
            case "compacted": {
              set((s) => {
                if (s.currentSessionId !== sessionIdAtSend) return;
                s.messages.push({
                  id: newId(),
                  role: "system",
                  items: [{
                    type: "compactionNotice",
                    id: newId(),
                    originalMessageCount: e.originalMessageCount ?? 0,
                    ts: e.ts ?? Date.now(),
                  }],
                });
              });
              break;
            }
            case "done": {
              patch((m) => { m.streaming = false; });
              finishStreaming();
              api.getBudget().then((b) => {
                if (b) set((s) => { s.budget = b; });
              }).catch(() => {});
              get().refreshSessions();
              break;
            }
            case "cancelled": {
              patch((m) => { m.streaming = false; });
              finishStreaming();
              break;
            }
            case "error": {
              patch((m) => { m.streaming = false; m.error = e.message; });
              finishStreaming();
              set((s) => {
                if (s.currentSessionId === sessionIdAtSend && !s.error) {
                  s.error = e.message ?? "An error occurred";
                }
              });
              break;
            }
          }
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        patch((m) => { m.streaming = false; m.error = msg; });
        finishStreaming();
        set((s) => {
          if (s.currentSessionId === sessionIdAtSend) s.error = msg;
        });
      }
    },

    cancel: () => {
      const { currentSessionId } = get();
      api.cancelChat(currentSessionId).catch(() => {});
    },

    setSelectedModel: async (key: string) => {
      const { models } = get();
      const model = models.find((m) => m.key === key);
      if (!model) return;
      set((s) => { s.selectedModel = model; });
      await api.setUserPref("selectedModel", key).catch(() => {});
    },

    setReasoningEffort: (effort: ReasoningEffort) => {
      set((s) => { s.reasoningEffort = effort; });
      api.setUserPref("reasoningEffort", effort).catch(() => {});
    },

    pickWorkspace: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        const info = await api.setWorkspace(selected);
        set((s) => { s.workspace = info; });
      }
    },

    resetToSandbox: async () => {
      const info = await api.useSandbox();
      set((s) => { s.workspace = info; });
    },

    refreshSessions: async () => {
      try {
        const sessions = await api.listSessions();
        set((s) => { s.sessions = sessions; });
      } catch {}
    },

    refreshBudget: async () => {
      try {
        const budget = await api.getBudget();
        if (budget) set((s) => { s.budget = budget; });
      } catch {}
    },

    refreshModels: async () => {
      try {
        const models = await api.listModels(true);
        set((s) => { s.models = models; });
      } catch {}
    },
  }))
);
