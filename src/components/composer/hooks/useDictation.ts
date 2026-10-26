import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";
import * as api from "../../../lib/api";
import { extractPromptFromDoc } from "../MentionNodeView";

export function useDictation({
  editorRef,
  setNotice,
}: {
  editorRef: React.RefObject<Editor | null>;
  setNotice: (notice: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);

  const toggleDictation = useCallback(async () => {
    if (recording) {
      setRecording(false);
      try {
        await api.stopDictation();
      } catch (e) {
        console.error("Failed to stop dictation:", e);
      }
      return;
    }
    setRecording(true);
    setNotice(null);
    try {
      await api.startDictation((event) => {
        setRecording(false);
        if (event.type === "final") {
          const editor = editorRef.current;
          if (event.text && editor) {
            const currentText = extractPromptFromDoc(editor.state.doc);
            const needsSpace =
              currentText.length > 0 && !/\s$/.test(currentText);
            editor
              .chain()
              .focus()
              .insertContent(needsSpace ? ` ${event.text}` : event.text)
              .run();
          }
        } else {
          setNotice(event.message);
        }
      });
    } catch (e) {
      setRecording(false);
      setNotice(api.errorMessage(e));
    }
  }, [recording, editorRef, setNotice]);

  const stopDictation = useCallback(async () => {
    if (!recording) return;
    setRecording(false);
    try {
      await api.stopDictation();
    } catch (e) {
      console.error("Failed to stop dictation:", e);
    }
  }, [recording]);

  return { recording, toggleDictation, stopDictation };
}
