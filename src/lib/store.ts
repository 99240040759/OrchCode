import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import { newId } from "./api";
import { useWorkspaceStore } from "./workspace";
import { useArtifactsStore } from "./artifacts";
import type {
  AttachmentRef,
  Budget,
  ChatStreamEvent,
  MessageItemView,
  MessageView,
  ModelDto,
  SessionSummary,
  ToolDisplayInfo,
} from "./api";

interface MessageAttachment {
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

interface TokenUsage {
  contextTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  items: MessageItem[];
  attachments: MessageAttachment[];
  streaming: boolean;
  error?: string;
  notice?: string;
}

const ZERO_USAGE: TokenUsage = { contextTokens: 0 };

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

function messageViewToLocal(v: MessageView): ChatMessage {
  return {
    id: v.id,
    role: v.role as ChatMessage["role"],
    items: v.items.map(viewItemToLocal),
    attachments: v.attachments.map((a) => ({
      name: a.name,
      isImage: a.isImage,
      path: a.path ?? undefined,
      dataUrl: a.dataUrl ?? undefined,
    })),
    streaming: false,
  };
}

function mergeAdjacentAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous?.role === "assistant" && message.role === "assistant") {
      previous.items.push(...message.items);
      continue;
    }
    merged.push({ ...message, items: [...message.items] });
  }
  return merged;
}

function usageFrom(session: SessionSummary): TokenUsage {
  return {
    contextTokens: session.contextTokens,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cachedTokens: session.cachedTokens,
    reasoningTokens: session.reasoningTokens,
  };
}

interface ChatState {
  connectorSelections: Record<string, string[]>;
  sessions: SessionSummary[];
  currentSessionId: string;
  messages: ChatMessage[];
  hasMoreMessages: boolean;
  earliestMessageId: number | null;
  loadingEarlierMessages: boolean;
  streaming: boolean;
  streamingSessionId: string | null;
  sessionTokens: TokenUsage;
  models: ModelDto[];
  selectedModel: ModelDto | null;
  thinkingEffort: string;
  budget: Budget | null;
  error: string | null;
  initialized: boolean;
}

interface ChatActions {
  initialize: () => Promise<void>;
  reloadForWorkspace: () => Promise<void>;
  reset: () => void;
  newChat: () => void;
  selectSession: (id: string) => Promise<void>;
  loadEarlierMessages: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  send: (prompt: string, attachments: AttachmentRef[]) => Promise<boolean>;
  cancel: () => void;
  toggleConnector: (id: string) => void;
  pruneConnectors: (connectedIds: string[]) => void;
  setSelectedModel: (key: string) => void;
  setThinkingEffort: (effort: string) => void;
  refreshSessions: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshBudget: () => Promise<void>;
  dismissError: () => void;
}

type ChatStore = ChatState & ChatActions;

const NO_CONNECTORS: string[] = [];

export function selectActiveConnectors(state: ChatState): string[] {
  return state.connectorSelections[state.currentSessionId] ?? NO_CONNECTORS;
}

const INITIAL_STATE: ChatState = {
  connectorSelections: {},
  sessions: [],
  currentSessionId: newId(),
  messages: [],
  hasMoreMessages: false,
  earliestMessageId: null,
  loadingEarlierMessages: false,
  streaming: false,
  streamingSessionId: null,
  sessionTokens: ZERO_USAGE,
  models: [],
  selectedModel: null,
  thinkingEffort: "low",
  budget: null,
  error: null,
  initialized: false,
};

type UnlistenFn = () => void;
let boundUnlisteners: UnlistenFn[] = [];
let listenerEpoch = 0;
let initEpoch = 0;
let isInitializing = false;

function unbindListeners() {
  listenerEpoch += 1;
  for (const fn of boundUnlisteners) fn();
  boundUnlisteners = [];
}

async function bindListeners() {
  unbindListeners();
  const epoch = listenerEpoch;
  const results = await Promise.allSettled([
    listen("sessions-updated", () => {
      void useChatStore.getState().refreshSessions();
    }),
    listen("models-updated", () => {
      void useChatStore.getState().refreshModels();
    }),
  ]);
  const fns = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) {
    for (const fn of fns) fn();
    throw failure.reason;
  }
  if (epoch !== listenerEpoch) {
    for (const fn of fns) fn();
    return;
  }
  boundUnlisteners = fns;
}

function pickModel(models: ModelDto[], key: string | null | undefined): ModelDto | null {
  return (key ? models.find((m) => m.key === key) : undefined) ?? models[0] ?? null;
}

let cancelActiveStreamFlush: (() => void) | null = null;

export const useChatStore = create(
  immer<ChatStore>((set, get) => ({
    ...INITIAL_STATE,

    initialize: async () => {
      if (isInitializing || get().initialized) return;
      isInitializing = true;
      const epoch = initEpoch;

      try {
        const wsPath = useWorkspaceStore.getState().current?.path ?? null;

        const [sessions, models, savedModel, savedEffort] = await Promise.all([
          wsPath
            ? api.listSessionsForWorkspace(wsPath).catch(() => [] as SessionSummary[])
            : Promise.resolve([] as SessionSummary[]),
          api.listModels().catch(() => [] as ModelDto[]),
          api.getUserPref("selectedModel").catch(() => null),
          api.getUserPref("thinkingEffort").catch(() => null),
        ]);
        if (epoch !== initEpoch) return;

        set((s) => {
          s.sessions = sessions;
          s.models = models;
          s.selectedModel = pickModel(models, savedModel);
          s.thinkingEffort = ["low", "medium", "high"].includes(savedEffort ?? "") ? savedEffort! : "low";
        });

        await bindListeners();
        if (epoch !== initEpoch) return;
        set((s) => {
          s.initialized = true;
        });
        void get().refreshBudget();
      } catch (e) {
        if (epoch === initEpoch) {
          set((s) => {
            s.initialized = false;
            s.error = api.errorMessage(e);
          });
        }
      } finally {
        if (epoch === initEpoch) isInitializing = false;
      }
    },

    reloadForWorkspace: async () => {
      if (cancelActiveStreamFlush) {
        cancelActiveStreamFlush();
        cancelActiveStreamFlush = null;
      }
      const running = get().streamingSessionId;
      if (running) await api.cancelChat(running).catch(() => undefined);
      const wsPath = useWorkspaceStore.getState().current?.path ?? null;
      const freshId = newId();
      useArtifactsStore.getState().dropWorkspaceTabs();

      const sessions = wsPath
        ? await api.listSessionsForWorkspace(wsPath).catch(() => [] as SessionSummary[])
        : [];

      set((s) => {
        s.sessions = sessions;
        s.currentSessionId = freshId;
        s.messages = [];
        s.sessionTokens = ZERO_USAGE;
        s.streaming = false;
        s.streamingSessionId = null;
        s.error = null;
      });
    },

    reset: () => {
      if (cancelActiveStreamFlush) {
        cancelActiveStreamFlush();
        cancelActiveStreamFlush = null;
      }
      const running = get().streamingSessionId;
      if (running) void api.cancelChat(running).catch(() => undefined);
      initEpoch += 1;
      isInitializing = false;
      unbindListeners();
      set((s) => {
        Object.assign(s, INITIAL_STATE, { currentSessionId: newId() });
      });
    },

    newChat: () => {
      if (get().streaming) return;
      const freshId = newId();
      set((s) => {
        s.currentSessionId = freshId;
        s.messages = [];
        s.hasMoreMessages = false;
        s.earliestMessageId = null;
        s.loadingEarlierMessages = false;
        s.sessionTokens = ZERO_USAGE;
        s.error = null;
      });
    },

    selectSession: async (id: string) => {
      if (get().streaming || get().currentSessionId === id) return;
      const target = get().sessions.find((s) => s.id === id);

      set((s) => {
        s.currentSessionId = id;
        s.messages = [];
        s.hasMoreMessages = false;
        s.earliestMessageId = null;
        s.loadingEarlierMessages = false;
        s.sessionTokens = target ? usageFrom(target) : ZERO_USAGE;
        s.error = null;
      });

      try {
        const page = await api.getSessionMessagesPage(id, 50);
        set((s) => {
          if (s.currentSessionId !== id) return;
          s.hasMoreMessages = page.hasMore;
          s.earliestMessageId = page.earliestMessageId;
          s.messages = mergeAdjacentAssistantMessages(page.messages.map(messageViewToLocal));
        });
      } catch (e) {
        set((s) => {
          if (s.currentSessionId === id) s.error = api.errorMessage(e);
        });
      }
    },

    loadEarlierMessages: async () => {
      const state = get();
      if (!state.hasMoreMessages || state.loadingEarlierMessages || state.earliestMessageId == null) return;
      const id = state.currentSessionId;
      set((s) => { s.loadingEarlierMessages = true; });

      try {
        const page = await api.getSessionMessagesPage(id, 50, state.earliestMessageId);
        set((s) => {
          if (s.currentSessionId !== id) return;
          s.loadingEarlierMessages = false;
          s.hasMoreMessages = page.hasMore;
          s.earliestMessageId = page.earliestMessageId;
          const earlierMessages: ChatMessage[] = page.messages.map(messageViewToLocal);
          s.messages = mergeAdjacentAssistantMessages([...earlierMessages, ...s.messages]);
        });
      } catch {
        set((s) => {
          s.loadingEarlierMessages = false;
        });
      }
    },

    deleteSession: async (id: string) => {
      if (get().streaming && (get().streamingSessionId === id || get().currentSessionId === id)) {
        try {
          await api.cancelChat(id);
        } catch {}
      }
      try {
        await api.clearSession(id);
      } catch (e) {
        set((s) => { s.error = api.errorMessage(e); });
        return;
      }
      set((s) => {
        s.sessions = s.sessions.filter((sess) => sess.id !== id);
        delete s.connectorSelections[id];
        if (s.currentSessionId === id) {
          s.currentSessionId = newId();
          s.messages = [];
          s.sessionTokens = ZERO_USAGE;
          s.streaming = false;
          if (s.streamingSessionId === id) s.streamingSessionId = null;
          s.error = null;
        }
      });
    },

    send: async (prompt: string, attachments: AttachmentRef[]) => {
      const { streaming, currentSessionId, selectedModel, connectorSelections } = get();
      const text = prompt.trim();
      if (streaming) return false;
      if (!text && attachments.length === 0) return false;
      if (!selectedModel) {
        set((s) => { s.error = "Select a model before sending a message"; });
        return false;
      }

      const sessionId = currentSessionId;
      const userMsgId = newId();
      const assistantMsgId = newId();

      set((s) => {
        s.error = null;
        s.streaming = true;
        s.streamingSessionId = sessionId;
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

      let activeAssistantId = assistantMsgId;

      const patch = (fn: (m: ChatMessage) => void) => {
        set((s) => {
          if (s.currentSessionId !== sessionId) return;
          const last = s.messages[s.messages.length - 1];
          if (last && last.id === activeAssistantId) {
            fn(last);
          } else {
            const msg = s.messages.find((m) => m.id === activeAssistantId);
            if (msg) fn(msg);
          }
        });
      };

      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        syncFlush();
        patch((m) => {
          m.streaming = false;
          for (const item of m.items) {
            if (item.type === "toolCall" && item.status === "running") item.status = "error";
          }
        });
        set((s) => {
          if (s.streamingSessionId === sessionId) s.streamingSessionId = null;
          if (s.currentSessionId === sessionId) s.streaming = false;
        });
      };

      let receivedEvents = false;

      let textBuffer = "";
      let reasoningBuffer = "";
      let rafId: number | null = null;
      let flushTimeoutId: ReturnType<typeof setTimeout> | null = null;

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
            else m.items.push({ type: "reasoning", id: newId(), text: pendingReasoning, active: true, startTime: Date.now() });
          }
          if (pendingText) {
            const last = m.items[m.items.length - 1];
            if (last?.type === "text") last.text += pendingText;
            else m.items.push({ type: "text", id: newId(), text: pendingText });
          }
        });
      };

      const scheduleFlush = () => {
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            rafId = null;
            if (flushTimeoutId !== null) {
              clearTimeout(flushTimeoutId);
              flushTimeoutId = null;
            }
            flush();
          });
          if (flushTimeoutId !== null) {
            clearTimeout(flushTimeoutId);
          }
          flushTimeoutId = setTimeout(() => {
            flushTimeoutId = null;
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
              flush();
            }
          }, 100);
        }
      };

      const syncFlush = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (flushTimeoutId !== null) {
          clearTimeout(flushTimeoutId);
          flushTimeoutId = null;
        }
        flush();
      };

      cancelActiveStreamFlush = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (flushTimeoutId !== null) {
          clearTimeout(flushTimeoutId);
          flushTimeoutId = null;
        }
        textBuffer = "";
        reasoningBuffer = "";
      };

      const handleEvent = (event: ChatStreamEvent) => {
        receivedEvents = true;
        switch (event.type) {
          case "text":
            textBuffer += event.delta;
            scheduleFlush();
            break;
          case "reasoning":
            reasoningBuffer += event.delta;
            scheduleFlush();
            break;
          case "reasoningDone":
            syncFlush();
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
            syncFlush();
            patch((m) => {
              m.items.push({ type: "toolCall", id: event.id, name: event.name, args: event.args, displayInfo: event.displayInfo, status: "running" });
            });
            break;
          case "toolResult":
            patch((m) => {
              for (let i = m.items.length - 1; i >= 0; i--) {
                const item = m.items[i];
                if (item.type === "toolCall" && item.id === event.id) {
                  item.output = event.output;
                  item.status = event.isError ? "error" : "done";
                  break;
                }
              }
            });
            break;
          case "usage":
            set((s) => {
              if (s.currentSessionId === sessionId)
                s.sessionTokens = {
                  contextTokens: event.contextTokens,
                  inputTokens: event.inputTokens,
                  outputTokens: event.outputTokens,
                  cachedTokens: event.cachedTokens,
                  reasoningTokens: event.reasoningTokens,
                };
            });
            break;
          case "notice":
            patch((m) => { m.notice = event.message; });
            break;
          case "compacted": {
            syncFlush();
            set((s) => {
              if (s.currentSessionId !== sessionId) return;
              const noticeId = event.compactionMessageId || newId();
              if (s.messages.some((m) => m.id === noticeId)) return;

              const notice: ChatMessage = {
                id: noticeId,
                role: "system",
                items: [
                  {
                    type: "compactionNotice",
                    id: event.compactionItemId || newId(),
                    originalMessageCount: event.originalMessageCount,
                    ts: event.ts,
                  },
                ],
                attachments: [],
                streaming: false,
              };

              const currentIdx = s.messages.findIndex((m) => m.id === activeAssistantId);
              if (currentIdx < 0) return;
              const current = s.messages[currentIdx];
              if (current.items.length === 0) {
                s.messages.splice(currentIdx, 0, notice);
                return;
              }
              current.streaming = false;
              const continuation: ChatMessage = {
                id: newId(),
                role: "assistant",
                items: [],
                attachments: [],
                streaming: true,
              };
              s.messages.push(notice, continuation);
              activeAssistantId = continuation.id;
            });
            break;
          }
          case "done":
            syncFlush(); settle();
            void useChatStore.getState().refreshBudget();
            break;
          case "cancelled":
            syncFlush(); settle();
            break;
          case "error":
            syncFlush();
            patch((m) => { m.error = event.message; });
            settle();
            break;
        }
      };

      try {
        await api.startChat(
          sessionId,
          selectedModel.key,
          text,
          attachments,
          connectorSelections[sessionId] ?? [],
          get().thinkingEffort,
          handleEvent
        );
        syncFlush(); settle();
        return true;
      } catch (e) {
        const message = api.errorMessage(e);
        syncFlush(); settle();
        if (!receivedEvents) {
          set((s) => {
            s.messages = s.messages.filter((m) => m.id !== userMsgId && m.id !== assistantMsgId);
            if (s.currentSessionId === sessionId && message !== "cancelled") s.error = message;
          });
          return false;
        }
        patch((m) => { m.error = message; });
        set((s) => {
          if (s.currentSessionId === sessionId) s.error = message;
        });
        return true;
      } finally {
        cancelActiveStreamFlush = null;
      }
    },

    toggleConnector: (id: string) => {
      set((s) => {
        const current = s.connectorSelections[s.currentSessionId] ?? [];
        const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
        if (next.length === 0) delete s.connectorSelections[s.currentSessionId];
        else s.connectorSelections[s.currentSessionId] = next;
      });
    },

    pruneConnectors: (connectedIds: string[]) => {
      set((s) => {
        for (const [sessionId, selected] of Object.entries(s.connectorSelections)) {
          const kept = selected.filter((id) => connectedIds.includes(id));
          if (kept.length === 0) delete s.connectorSelections[sessionId];
          else if (kept.length !== selected.length) s.connectorSelections[sessionId] = kept;
        }
      });
    },

    cancel: () => {
      const target = get().streamingSessionId ?? get().currentSessionId;
      void api.cancelChat(target).catch(() => undefined);
    },

    setSelectedModel: (key: string) => {
      const model = get().models.find((m) => m.key === key);
      if (!model) return;
      set((s) => { s.selectedModel = model; });
      void api.setUserPref("selectedModel", key).catch(() => undefined);
    },

    setThinkingEffort: (effort: string) => {
      if (!["low", "medium", "high"].includes(effort)) return;
      set((s) => { s.thinkingEffort = effort; });
      void api.setUserPref("thinkingEffort", effort).catch(() => undefined);
    },

    refreshSessions: async () => {
      try {
        const wsPath = useWorkspaceStore.getState().current?.path ?? null;
        if (!wsPath) return;
        const sessions = await api.listSessionsForWorkspace(wsPath);
        if (useWorkspaceStore.getState().current?.path !== wsPath) return;
        set((s) => {
          s.sessions = sessions;
          if (!s.streaming) {
            const current = sessions.find((sess) => sess.id === s.currentSessionId);
            if (current) s.sessionTokens = usageFrom(current);
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
          s.selectedModel = pickModel(models, s.selectedModel?.key);
        });
      } catch {
        return;
      }
    },

    refreshBudget: async () => {
      try {
        const budget = await api.getBudget();
        set((s) => { s.budget = budget; });
      } catch {
        return;
      }
    },

    dismissError: () => {
      set((s) => { s.error = null; });
    },
  }))
);

useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id && useChatStore.getState().initialized) {
    void useChatStore.getState().reloadForWorkspace();
  }
});
