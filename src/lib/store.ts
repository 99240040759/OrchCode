import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import { newId } from "./api";
import { useWorkspaceStore } from "./workspace";
import { useArtifactsStore } from "./artifacts";
import { useConnectorsStore } from "./connectors";
import {
  applyResult,
  deltaText,
  recordsToMessages,
  resultFromStep,
  toolItemFromStep,
  usageFromEvent,
} from "./steps";
import type {
  AttachmentRef,
  Budget,
  ChatStreamEvent,
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

function showSession(s: ChatState, id: string, tokens: TokenUsage) {
  s.currentSessionId = id;
  s.messages = [];
  s.hasMoreMessages = false;
  s.earliestSeq = null;
  s.loadingEarlierMessages = false;
  s.sessionTokens = tokens;
  s.error = null;
}

interface ChatState {
  connectorSelections: Record<string, string[]>;
  sessions: SessionSummary[];
  currentSessionId: string;
  messages: ChatMessage[];
  hasMoreMessages: boolean;
  earliestSeq: number | null;
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
  resumeRun: (id: string) => Promise<void>;
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
  earliestSeq: null,
  loadingEarlierMessages: false,
  streaming: false,
  streamingSessionId: null,
  sessionTokens: ZERO_USAGE,
  models: [],
  selectedModel: null,
  thinkingEffort: "high",
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
    listen("connector-changed", () => {
      void useConnectorsStore.getState().refresh();
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

const activeStreamFlushes = new Map<string, () => void>();

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
          s.thinkingEffort =
            savedEffort && ["low", "medium", "high"].includes(savedEffort)
              ? savedEffort
              : "high";
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
      const running = get().streamingSessionId;
      if (running) {
        activeStreamFlushes.get(running)?.();
        activeStreamFlushes.delete(running);
        await api.cancelChat(running).catch(() => undefined);
      }
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
      void api.setCloudSession(freshId).catch(() => undefined);
      await get().refreshModels();
    },

    reset: () => {
      const running = get().streamingSessionId;
      if (running) void api.cancelChat(running).catch(() => undefined);
      for (const cancel of activeStreamFlushes.values()) cancel();
      activeStreamFlushes.clear();
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
        showSession(s, freshId, ZERO_USAGE);
      });
      void api.setCloudSession(freshId).catch(() => undefined);
    },

    selectSession: async (id: string) => {
      if (get().streaming || get().currentSessionId === id) return;
      const target = get().sessions.find((s) => s.id === id);

      set((s) => {
        showSession(s, id, target ? usageFrom(target) : ZERO_USAGE);
      });
      void api.setCloudSession(id).catch(() => undefined);

      try {
        const page = await api.getSessionRecords(id, 50);
        set((s) => {
          if (s.currentSessionId !== id) return;
          s.hasMoreMessages = page.hasMore;
          s.earliestSeq = page.earliestSeq;
          s.messages = mergeAdjacentAssistantMessages(recordsToMessages(page.records));
        });
        if (get().sessions.find((sess) => sess.id === id)?.running) {
          void get().resumeRun(id);
        }
      } catch (e) {
        set((s) => {
          if (s.currentSessionId === id) s.error = api.errorMessage(e);
        });
      }
    },

    loadEarlierMessages: async () => {
      const state = get();
      if (!state.hasMoreMessages || state.loadingEarlierMessages || state.earliestSeq == null) return;
      const id = state.currentSessionId;
      set((s) => { s.loadingEarlierMessages = true; });

      try {
        const page = await api.getSessionRecords(id, 50, state.earliestSeq);
        set((s) => {
          if (s.currentSessionId !== id) return;
          s.loadingEarlierMessages = false;
          s.hasMoreMessages = page.hasMore;
          s.earliestSeq = page.earliestSeq;
          const earlierMessages: ChatMessage[] = recordsToMessages(page.records);
          s.messages = mergeAdjacentAssistantMessages([...earlierMessages, ...s.messages]);
        });
      } catch (e) {
        set((s) => {
          if (s.currentSessionId === id) {
            s.loadingEarlierMessages = false;
            s.error = api.errorMessage(e);
          }
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
      void api.setCloudSession(get().currentSessionId).catch(() => undefined);
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

      return streamRun(sessionId, userMsgId, assistantMsgId, (onEvent) =>
        api.startChat(
          sessionId,
          selectedModel.key,
          text,
          attachments,
          connectorSelections[sessionId] ?? [],
          get().thinkingEffort,
          onEvent
        )
      );
    },

    resumeRun: async (id: string) => {
      if (get().streaming || get().currentSessionId !== id) return;
      const assistantMsgId = newId();
      set((s) => {
        s.error = null;
        s.streaming = true;
        s.streamingSessionId = id;
        while (s.messages.length > 0 && s.messages[s.messages.length - 1].role !== "user") {
          s.messages.pop();
        }
        s.messages.push({
          id: assistantMsgId,
          role: "assistant",
          items: [],
          attachments: [],
          streaming: true,
        });
      });
      await streamRun(id, null, assistantMsgId, (onEvent) => api.resumeChat(id, onEvent));
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
      activeStreamFlushes.get(target)?.();
      activeStreamFlushes.delete(target);
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

async function streamRun(
  sessionId: string,
  userMsgId: string | null,
  assistantMsgId: string,
  start: (onEvent: (evt: ChatStreamEvent) => void) => Promise<void>
): Promise<boolean> {
  const set = useChatStore.setState;
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

    activeStreamFlushes.set(sessionId, () => {
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
    });

    const stepKinds = new Map<number, "thought" | "text">();
    const thoughtStarts = new Map<number, number>();

    const closeThought = (index: number, reportedSeconds?: number) => {
      const started = thoughtStarts.get(index);
      thoughtStarts.delete(index);
      const seconds =
        reportedSeconds ?? Math.max(1, Math.round((Date.now() - (started ?? Date.now())) / 1000));
      syncFlush();
      patch((m) => {
        for (let i = m.items.length - 1; i >= 0; i--) {
          const item = m.items[i];
          if (item.type === "reasoning" && item.active) {
            item.active = false;
            item.durationSeconds = seconds;
            break;
          }
        }
      });
    };

    const handleEvent = (event: ChatStreamEvent) => {
      receivedEvents = true;

      const usage = usageFromEvent(event);
      if (usage) {
        set((s) => {
          if (s.currentSessionId !== sessionId) return;
          s.sessionTokens = {
            contextTokens: usage.contextTokens ?? s.sessionTokens.contextTokens,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedTokens: usage.cachedTokens,
            reasoningTokens: usage.reasoningTokens,
          };
        });
      }

      switch (event.event_type) {
        case "step.start": {
          const step = event.step;
          const index = event.index;
          if (!step || index === undefined) break;
          if (step.type === "thought") {
            stepKinds.set(index, "thought");
            thoughtStarts.set(index, Date.now());
            break;
          }
          if (step.type === "model_output") {
            stepKinds.set(index, "text");
            break;
          }
          const tool = toolItemFromStep(step);
          if (tool) {
            syncFlush();
            patch((m) => {
              m.items.push(tool);
            });
            break;
          }
          const result = resultFromStep(step);
          if (result) {
            patch((m) => {
              applyResult(m.items, result);
            });
          }
          break;
        }
        case "step.delta": {
          const index = event.index;
          if (index === undefined) break;
          const text = deltaText(event.delta);
          if (!text) break;
          const kind = stepKinds.get(index);
          if (kind === "thought") {
            reasoningBuffer += text;
            scheduleFlush();
          } else if (kind === "text") {
            textBuffer += text;
            scheduleFlush();
          }
          break;
        }
        case "step.stop": {
          const index = event.index;
          if (index === undefined) break;
          const kind = stepKinds.get(index);
          stepKinds.delete(index);
          if (kind === "thought") closeThought(index, event.duration_seconds);
          else if (kind === "text") syncFlush();
          break;
        }
        case "orch.notice":
          patch((m) => {
            m.notice = event.message;
          });
          break;
        case "orch.compacted": {
          syncFlush();
          set((s) => {
            if (s.currentSessionId !== sessionId) return;
            const noticeId = event.message_id || newId();
            if (s.messages.some((m) => m.id === noticeId)) return;

            const notice: ChatMessage = {
              id: noticeId,
              role: "system",
              items: [
                {
                  type: "compactionNotice",
                  id: event.item_id || newId(),
                  originalMessageCount: event.original_message_count ?? 0,
                  ts: event.ts ?? Date.now(),
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
        case "interaction.status_update":
          if (event.status === "cancelled") {
            syncFlush();
            settle();
          }
          break;
        case "error": {
          syncFlush();
          const message = event.error?.message ?? event.message ?? "The agent stopped unexpectedly.";
          patch((m) => {
            m.error = message;
          });
          settle();
          break;
        }
        case "orch.resync":
          syncFlush();
          stepKinds.clear();
          thoughtStarts.clear();
          patch((m) => {
            m.items = [];
            m.error = undefined;
            m.notice = undefined;
          });
          break;
        case "done":
          syncFlush();
          settle();
          void useChatStore.getState().refreshBudget();
          break;
      }
    };

    try {
      await start(handleEvent);
      syncFlush(); settle();
      return true;
    } catch (e) {
      const message = api.errorMessage(e);
      syncFlush(); settle();
      if (!receivedEvents) {
        set((s) => {
          s.messages = s.messages.filter(
            (m) => m.id !== assistantMsgId && (userMsgId === null || m.id !== userMsgId)
          );
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
      activeStreamFlushes.delete(sessionId);
    }
}

useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id && useChatStore.getState().initialized) {
    void useChatStore.getState().reloadForWorkspace();
  }
});
