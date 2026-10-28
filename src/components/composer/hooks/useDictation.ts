import { useCallback, useRef, useState } from "react";
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
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  const toggleDictation = useCallback(async () => {
    if (recordingRef.current) {
      try {
        await api.stopDictation();
        setRecording(false);
      } catch (e) {
        setNotice(api.errorMessage(e));
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
  }, [editorRef, setNotice]);

  const stopDictation = useCallback(async () => {
    if (!recordingRef.current) return;
    try {
      await api.stopDictation();
      setRecording(false);
    } catch (e) {
      setNotice(api.errorMessage(e));
    }
  }, [setNotice]);

  return { recording, toggleDictation, stopDictation };
}
