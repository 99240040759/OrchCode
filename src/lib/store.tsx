import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { immer } from "zustand/middleware/immer";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import { newId } from "./api";
import type {
  AttachmentRef,
  Budget,
  ChatStreamEvent,
  MessageItemView,
  ModelDto,
  SessionSummary,
  ToolDisplayInfo,
  WorkspaceInfo,
} from "./api";

export interface MessageAttachment {
  name: string;
  isImage: boolean;
  path?: string;
  dataUrl?: string;
}

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
  attachments: MessageAttachment[];
  streaming: boolean;
  error?: string;
  usage?: TokenUsage;
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

let sessionsListenerBound = false;
let modelsListenerBound = false;

function viewItemToLocal(item: MessageItemView): MessageItem {
  switch (item.type) {
    case "text":
      return { type: "text", id: item.id, text: item.text };
    case "reasoning":
      return {
        type: "reasoning",
        id: item.id,
        text: item.text,
        active: false,
        startTime: 0,
        durationSeconds: item.durationSeconds ?? undefined,
      };
    case "compactionNotice":
      return {
        type: "compactionNotice",
        id: item.id,
        originalMessageCount: item.originalMessageCount,
        ts: item.ts,
      };
    case "toolCall":
      return {
        type: "toolCall",
        id: item.id,
        name: item.name,
        args: item.args,
        displayInfo: item.displayInfo,
        output: item.output ?? undefined,
        status: item.status === "error" ? "error" : "done",
      };
  }
}

function usageFrom(session: SessionSummary): TokenUsage {
  return {
    inputTokens: session.lastInputTokens,
    outputTokens: session.lastOutputTokens,
    totalTokens: session.lastTotalTokens,
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
  budget: Budget | null;
  workspace: WorkspaceInfo | null;
  error: string | null;
  initialized: boolean;
}

interface ChatActions {
  initialize: () => Promise<void>;
  reset: () => void;
  newChat: () => void;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  send: (prompt: string, attachments: AttachmentRef[]) => Promise<boolean>;
  cancel: () => void;
  setSelectedModel: (key: string) => void;
  pickWorkspace: () => Promise<void>;
  resetToSandbox: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshBudget: () => Promise<void>;
  dismissError: () => void;
}

export type ChatStore = ChatState & ChatActions;

const INITIAL_STATE: ChatState = {
  sessions: [],
  currentSessionId: newId(),
  sessionGeneration: 0,
  messages: [],
  streaming: false,
  sessionTokens: ZERO_USAGE,
  models: [],
  selectedModel: null,
  budget: null,
  workspace: null,
  error: null,
  initialized: false,
};

export const useChatStore = create(
  immer<ChatStore>((set, get) => ({
    ...INITIAL_STATE,

    initialize: async () => {
      if (get().initialized) return;
      set((s) => {
        s.initialized = true;
      });

      const [sessions, workspace, models, savedModel] = await Promise.all([
        api.listSessions().catch(() => [] as SessionSummary[]),
        api.getWorkspaceInfo().catch(() => null),
        api.listModels().catch(() => [] as ModelDto[]),
        api.getUserPref("selectedModel").catch(() => null),
      ]);

      set((s) => {
        s.sessions = sessions;
        if (workspace) s.workspace = workspace;
        s.models = models;
        const preferred = savedModel ? models.find((m) => m.key === savedModel) : undefined;
        s.selectedModel = preferred ?? models[0] ?? null;
      });

      void get().refreshBudget();

      if (!sessionsListenerBound) {
        sessionsListenerBound = true;
        await listen("sessions-updated", () => {
          void get().refreshSessions();
        });
      }
      if (!modelsListenerBound) {
        modelsListenerBound = true;
        await listen("models-updated", () => {
          void get().refreshModels();
        });
      }
      await listen("workspace-changed", () => {
        api.getWorkspaceInfo().then((ws) => {
          if (ws) set((s) => { s.workspace = ws; });
        }).catch(() => undefined);
      });
    },

    reset: () => {
      set((s) => {
        Object.assign(s, INITIAL_STATE, {
          currentSessionId: newId(),
          sessionGeneration: s.sessionGeneration + 1,
        });
      });
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
      if (get().streaming || get().currentSessionId === id) return;
      const target = get().sessions.find((s) => s.id === id);

      set((s) => {
        s.currentSessionId = id;
        s.sessionGeneration += 1;
        s.messages = [];
        s.sessionTokens = target ? usageFrom(target) : ZERO_USAGE;
        s.error = null;
      });

      if (target?.workspacePath) {
        try {
          const info = await api.setWorkspace(target.workspacePath);
          set((s) => {
            if (s.currentSessionId === id) s.workspace = info;
          });
        } catch (e) {
          set((s) => {
            if (s.currentSessionId === id) s.error = api.errorMessage(e);
          });
        }
      }

      try {
        const views = await api.getSessionView(id);
        set((s) => {
          if (s.currentSessionId !== id) return;
          s.messages = views.map((v) => ({
            id: v.id,
            role: v.role as ChatMessage["role"],
            items: v.items.map(viewItemToLocal),
            attachments: v.attachments.map((a) => ({
              name: a.name,
              isImage: a.isImage,
              dataUrl: a.dataUrl ?? undefined,
            })),
            streaming: false,
          }));
        });
      } catch (e) {
        set((s) => {
          if (s.currentSessionId === id) s.error = api.errorMessage(e);
        });
      }
    },

    deleteSession: async (id: string) => {
      if (get().streaming && get().currentSessionId === id) {
        get().cancel();
      }
      try {
        await api.clearSession(id);
      } catch (e) {
        set((s) => {
          s.error = api.errorMessage(e);
        });
        return;
      }
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

    send: async (prompt: string, attachments: AttachmentRef[]) => {
      const { streaming, currentSessionId, selectedModel } = get();
      const text = prompt.trim();
      if (streaming) return false;
      if (!text && attachments.length === 0) return false;
      if (!selectedModel) {
        set((s) => {
          s.error = "Select a model before sending a message";
        });
        return false;
      }

      const sessionId = currentSessionId;
      const userMsgId = newId();
      const assistantMsgId = newId();

      set((s) => {
        s.error = null;
        s.streaming = true;
        s.messages.push({
          id: userMsgId,
          role: "user",
          items: [{ type: "text", id: newId(), text }],
          attachments: attachments.map((a) => ({
            name: a.name,
            isImage: a.isImage,
            path: a.path,
          })),
          streaming: false,
        });
        s.messages.push({
          id: assistantMsgId,
          role: "assistant",
          items: [],
          attachments: [],
          streaming: true,
        });
      });

      const patch = (fn: (m: ChatMessage) => void) => {
        set((s) => {
          if (s.currentSessionId !== sessionId) return;
          const msg = s.messages.find((m) => m.id === assistantMsgId);
          if (msg) fn(msg);
        });
      };

      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        patch((m) => {
          m.streaming = false;
        });
        set((s) => {
          if (s.currentSessionId === sessionId) s.streaming = false;
        });
      };

      let textBuffer = "";
      let reasoningBuffer = "";
      let flushTimer: ReturnType<typeof setInterval> | null = null;

      const flush = () => {
        const pendingText = textBuffer;
        const pendingReasoning = reasoningBuffer;
        textBuffer = "";
        reasoningBuffer = "";
        if (!pendingText && !pendingReasoning) return;
        patch((m) => {
          if (pendingReasoning) {
            const last = m.items[m.items.length - 1];
            if (last?.type === "reasoning" && last.active) last.text += pendingReasoning;
            else
              m.items.push({
                type: "reasoning",
                id: newId(),
                text: pendingReasoning,
                active: true,
                startTime: Date.now(),
              });
          }
          if (pendingText) {
            const last = m.items[m.items.length - 1];
            if (last?.type === "text") last.text += pendingText;
            else m.items.push({ type: "text", id: newId(), text: pendingText });
          }
        });
      };

      const startFlushTimer = () => {
        if (flushTimer === null) flushTimer = setInterval(flush, 40);
      };

      const stopFlushTimer = () => {
        if (flushTimer !== null) {
          clearInterval(flushTimer);
          flushTimer = null;
        }
      };

      const handleEvent = (event: ChatStreamEvent) => {
        switch (event.type) {
          case "text":
            textBuffer += event.delta;
            startFlushTimer();
            break;
          case "reasoning":
            reasoningBuffer += event.delta;
            startFlushTimer();
            break;
          case "reasoningDone":
            stopFlushTimer();
            flush();
            patch((m) => {
              for (let i = m.items.length - 1; i >= 0; i--) {
                const item = m.items[i];
                if (item.type === "reasoning" && item.active) {
                  item.active = false;
                  item.durationSeconds = event.durationSeconds;
                  break;
                }
              }
            });
            break;
          case "toolCall":
            stopFlushTimer();
            flush();
            patch((m) => {
              m.items.push({
                type: "toolCall",
                id: event.id,
                name: event.name,
                args: event.args,
                displayInfo: event.displayInfo,
                status: "running",
              });
            });
            break;
          case "toolResult":
            patch((m) => {
              const item = m.items.find(
                (i): i is ToolCallItem => i.type === "toolCall" && i.id === event.id
              );
              if (item) {
                item.output = event.output;
                item.status = event.isError ? "error" : "done";
              }
            });
            break;
          case "usage": {
            const usage: TokenUsage = {
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              totalTokens: event.totalTokens,
            };
            patch((m) => {
              m.usage = usage;
            });
            set((s) => {
              if (s.currentSessionId === sessionId) s.sessionTokens = usage;
            });
            break;
          }
          case "compacted":
            set((s) => {
              if (s.currentSessionId !== sessionId) return;
              s.messages.push({
                id: newId(),
                role: "system",
                items: [
                  {
                    type: "compactionNotice",
                    id: newId(),
                    originalMessageCount: event.originalMessageCount,
                    ts: event.ts,
                  },
                ],
                attachments: [],
                streaming: false,
              });
            });
            break;
          case "done":
            stopFlushTimer();
            flush();
            settle();
            void get().refreshBudget();
            break;
          case "cancelled":
            stopFlushTimer();
            flush();
            settle();
            break;
          case "error":
            stopFlushTimer();
            flush();
            patch((m) => {
              m.error = event.message;
            });
            settle();
            set((s) => {
              if (s.currentSessionId === sessionId) s.error = event.message;
            });
            break;
        }
      };

      try {
        await api.startChat(
          sessionId,
          selectedModel.key,
          text,
          attachments,
          handleEvent
        );
        stopFlushTimer();
        flush();
        settle();
        return true;
      } catch (e) {
        const message = api.errorMessage(e);
        stopFlushTimer();
        flush();
        settle();
        set((s) => {
          if (s.currentSessionId !== sessionId) return;
          s.error = message;
          s.messages = s.messages.filter(
            (m) => m.id !== userMsgId && m.id !== assistantMsgId
          );
        });
        return false;
      }
    },

    cancel: () => {
      void api.cancelChat(get().currentSessionId).catch(() => undefined);
    },

    setSelectedModel: (key: string) => {
      const model = get().models.find((m) => m.key === key);
      if (!model) return;
      set((s) => {
        s.selectedModel = model;
      });
      void api.setUserPref("selectedModel", key).catch(() => undefined);
    },

    pickWorkspace: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      try {
        const info = await api.setWorkspace(selected);
        set((s) => {
          s.workspace = info;
        });
      } catch (e) {
        set((s) => {
          s.error = api.errorMessage(e);
        });
      }
    },

    resetToSandbox: async () => {
      try {
        const info = await api.useSandbox();
        set((s) => {
          s.workspace = info;
        });
      } catch (e) {
        set((s) => {
          s.error = api.errorMessage(e);
        });
      }
    },

    refreshSessions: async () => {
      try {
        const sessions = await api.listSessions();
        set((s) => {
          s.sessions = sessions;
          if (!s.streaming) {
            const current = sessions.find((sess) => sess.id === s.currentSessionId);
            if (current) {
              s.sessionTokens = usageFrom(current);
            }
          }
        });
      } catch {
        return;
      }
    },

    refreshModels: async () => {
      try {
        const models = await api.listModels();
        set((s) => {
          s.models = models;
          if (s.selectedModel) {
            const current = models.find((m) => m.key === s.selectedModel?.key);
            s.selectedModel = current ?? models[0] ?? null;
          } else {
            s.selectedModel = models[0] ?? null;
          }
        });
      } catch {
        return;
      }
    },

    refreshBudget: async () => {
      try {
        const budget = await api.getBudget();
        set((s) => {
          s.budget = budget;
        });
      } catch {
        return;
      }
    },

    dismissError: () => {
      set((s) => {
        s.error = null;
      });
    },
  }))
);

export type UpdateStatus =
  | "idle"
  | "checking"
  | "none"
  | "downloading"
  | "readyToRestart"
  | "installing"
  | "failed";

interface UpdaterState {
  status: UpdateStatus;
  version: string;
  percent: number;
  error: string | null;
}

interface UpdaterActions {
  start: () => Promise<void>;
  apply: () => Promise<void>;
}

export type UpdaterStore = UpdaterState & UpdaterActions;

let pendingUpdate: Update | null = null;
let updateStarted = false;

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  status: "idle",
  version: "",
  percent: 0,
  error: null,

  start: async () => {
    if (updateStarted) return;
    updateStarted = true;
    set({ status: "checking", error: null });

    let update: Update | null = null;
    try {
      update = await check();
    } catch (e) {
      set({ status: "failed", error: api.errorMessage(e) });
      return;
    }

    if (!update?.available) {
      set({ status: "none" });
      return;
    }

    pendingUpdate = update;
    set({ status: "downloading", version: update.version, percent: 0 });

    let contentLength = 0;
    let received = 0;

    try {
      await update.download((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          received = 0;
          set({ percent: 0 });
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (contentLength > 0) {
            set({ percent: Math.min(99, Math.round((received / contentLength) * 100)) });
          }
        } else if (event.event === "Finished") {
          set({ percent: 100 });
        }
      });
      set({ status: "readyToRestart" });
    } catch (e) {
      pendingUpdate = null;
      set({ status: "failed", error: api.errorMessage(e) });
    }
  },

  apply: async () => {
    if (get().status !== "readyToRestart" || !pendingUpdate) return;
    set({ status: "installing", error: null });
    try {
      await pendingUpdate.install();
      await relaunch();
    } catch (e) {
      set({ status: "readyToRestart", error: api.errorMessage(e) });
    }
  },
}));
