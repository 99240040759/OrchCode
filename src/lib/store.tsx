import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import * as api from "./api";
import { newId } from "./utils";
import type { ModelDto, Budget, WorkspaceInfo, SessionSummary, ToolDisplayInfo, MessageItemView } from "./api";

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

export type MessageItem = ReasoningItem | ToolCallItem | TextItem;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  items: MessageItem[];
  streaming?: boolean;
  error?: string;
  usage?: TokenUsage;
}

function viewItemToLocal(item: MessageItemView): MessageItem {
  if (item.type === "text") return { type: "text", id: item.id, text: item.text };
  if (item.type === "reasoning") return { type: "reasoning", id: item.id, text: item.text, active: false, startTime: 0 };
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
  compacting: boolean;
  models: ModelDto[];
  selectedModel: ModelDto | null;
  reasoningEffort: "low" | "medium" | "high";
  budget: Budget | null;
  workspace: WorkspaceInfo | null;
  error: string | null;
}

interface ChatActions {
  initialize: () => Promise<void>;
  newChat: () => void;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  send: (prompt: string, attachmentBlock?: string) => Promise<void>;
  cancel: () => void;
  compactSession: () => Promise<string>;
  setSelectedModel: (key: string) => Promise<void>;
  setReasoningEffort: (effort: "low" | "medium" | "high") => void;
  pickWorkspace: () => Promise<void>;
  resetToSandbox: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshBudget: () => Promise<void>;
  refreshModels: () => Promise<void>;
}

export type ChatStore = ChatState & ChatActions;

export const useChatStore = create(
  immer<ChatStore>((set, get) => ({
    sessions: [],
    currentSessionId: newId(),
    sessionGeneration: 0,
    messages: [],
    streaming: false,
    compacting: false,
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
      const savedModelKey = await api.getUserPref("selectedModel").catch(() => null);
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
      });
      api.getBudget().then((b) => {
        if (b) set((s) => { s.budget = b; });
      }).catch(() => {});

      if (api.inTauri()) {
        import("@tauri-apps/api/event").then(({ listen }) => {
          listen("sessions-updated", () => {
            get().refreshSessions();
          });
        }).catch(() => {});
      }
    },

    newChat: () => {
      if (get().streaming) return;
      set((s) => {
        s.currentSessionId = newId();
        s.sessionGeneration += 1;
        s.messages = [];
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
            role: v.role,
            items: v.items.map(viewItemToLocal),
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
          s.streaming = false;
          s.error = null;
        }
      });
    },

    send: async (prompt: string, attachmentBlock?: string) => {
      const { streaming, currentSessionId, selectedModel, reasoningEffort } = get();
      const text = prompt.trim();
      if ((!text && !attachmentBlock) || streaming) return;

      const fullPrompt = text && attachmentBlock ? `${text}\n\n${attachmentBlock}` : attachmentBlock || text;
      const userMsgId = newId();
      const assistantMsgId = newId();
      const sessionIdAtSend = currentSessionId;

      set((s) => {
        s.error = null;
        s.streaming = true;
        s.messages.push({ id: userMsgId, role: "user", items: [{ type: "text", id: newId(), text: fullPrompt }] });
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
        await api.startChat(sessionIdAtSend, selectedModel?.key ?? "", fullPrompt, reasoningEffort, (raw: unknown) => {
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
              patch((m) => {
                m.usage = {
                  inputTokens: ue.inputTokens ?? 0,
                  outputTokens: ue.outputTokens ?? 0,
                  totalTokens: ue.totalTokens ?? 0,
                };
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
              api.getSessionView(sessionIdAtSend).then((views) => {
                set((s) => {
                  if (s.currentSessionId !== sessionIdAtSend) return;
                  s.messages = views.map((v) => ({
                    id: v.id,
                    role: v.role,
                    items: v.items.map(viewItemToLocal),
                    streaming: false,
                  }));
                });
              }).catch(() => {});
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

    compactSession: async () => {
      const { streaming, compacting, currentSessionId, selectedModel } = get();
      if (streaming) return "Agent is running — cancel it first.";
      if (compacting) return "Compaction already in progress.";

      set((s) => { s.compacting = true; s.error = null; });

      try {
        const result = await api.compactChat(currentSessionId, selectedModel?.key ?? "");
        const views = await api.getSessionView(currentSessionId);
        set((s) => {
          s.compacting = false;
          if (s.currentSessionId !== currentSessionId) return;
          s.messages = [
            ...views.map((v) => ({
              id: v.id,
              role: v.role as "user" | "assistant",
              items: v.items.map(viewItemToLocal),
              streaming: false,
            })),
            {
              id: newId(),
              role: "assistant" as const,
              items: [{ type: "text" as const, id: newId(), text: `✦ ${result}` }],
              streaming: false,
            },
          ];
        });
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set((s) => { s.compacting = false; s.error = msg; });
        return `Compaction failed: ${msg}`;
      }
    },

    setSelectedModel: async (key: string) => {
      const { models } = get();
      const model = models.find((m) => m.key === key);
      if (!model) return;
      set((s) => { s.selectedModel = model; });
      await api.setUserPref("selectedModel", key).catch(() => {});
    },

    setReasoningEffort: (effort: "low" | "medium" | "high") => {
      set((s) => { s.reasoningEffort = effort; });
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
