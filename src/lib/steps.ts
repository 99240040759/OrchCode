import type { HistoryUserPart, SessionRecord } from "./api";
import type { ChatMessage } from "./store";
import { getBasename } from "./utils";

function userMessage(seq: number, content: HistoryUserPart[]): ChatMessage {
  const text = content
    .filter(
      (part): part is Extract<HistoryUserPart, { type: "text" }> =>
        part.type === "text" && Boolean(part.text)
    )
    .map((part) => part.text)
    .join("\n\n");
  const attachments: ChatMessage["attachments"] = [];
  for (const part of content) {
    if (part.type === "image") {
      const mime = part.mimeType || "image/png";
      attachments.push({
        name: `image.${mime.split("/")[1] ?? "png"}`,
        isImage: true,
        dataUrl: part.data ? `data:${mime};base64,${part.data}` : part.uri,
      });
    } else if (part.type === "document") {
      attachments.push({
        name: part.name || getBasename(part.path ?? "") || "document",
        isImage: false,
        path: part.path,
      });
    }
  }
  return {
    id: `h-${seq}`,
    role: "user",
    items: text ? [{ type: "text", id: `h-${seq}-text`, text }] : [],
    attachments,
    streaming: false,
  };
}

export function recordsToMessages(records: SessionRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let assistant: ChatMessage | null = null;

  const ensureAssistant = (seq: number): ChatMessage => {
    if (assistant) return assistant;
    const created: ChatMessage = {
      id: `h-${seq}`,
      role: "assistant",
      items: [],
      attachments: [],
      streaming: false,
    };
    messages.push(created);
    assistant = created;
    return created;
  };

  for (const record of records) {
    switch (record.kind) {
      case "user":
        assistant = null;
        messages.push(userMessage(record.seq, record.content));
        break;
      case "work":
        ensureAssistant(record.seq).items.push({
          type: "work",
          id: `h-${record.seq}`,
          active: false,
          durationSeconds: record.durationSeconds,
          stopped: record.stopped,
        });
        break;
      case "reasoning":
        if (!record.text) break;
        ensureAssistant(record.seq).items.push({
          type: "reasoning",
          id: `h-${record.seq}`,
          text: record.text,
          active: false,
          startTime: 0,
          durationSeconds: record.durationSeconds,
        });
        break;
      case "toolCall":
        ensureAssistant(record.seq).items.push({
          type: "toolCall",
          id: record.id || `h-${record.seq}`,
          name: record.name,
          args: JSON.stringify(record.arguments ?? {}),
          displayInfo: record.display,
          output: record.output,
          status: record.isError ? "error" : "done",
        });
        break;
      case "text":
        if (!record.text) break;
        ensureAssistant(record.seq).items.push({
          type: "text",
          id: `h-${record.seq}`,
          text: record.text,
        });
        break;
      case "compaction":
        assistant = null;
        messages.push({
          id: record.id || `h-${record.seq}`,
          role: "system",
          items: [
            {
              type: "compactionNotice",
              id: record.id ? `${record.id}-notice` : `h-${record.seq}-compaction`,
              originalMessageCount: record.originalMessageCount,
              ts: record.ts,
            },
          ],
          attachments: [],
          streaming: false,
        });
        break;
      case "error":
        ensureAssistant(record.seq).error = record.message;
        break;
    }
  }
  return messages;
}
