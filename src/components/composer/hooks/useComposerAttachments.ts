import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import * as api from "../../../lib/api";
import * as utils from "../../../lib/utils";

export function useComposerAttachments({
  modelSupportsImages,
  modelName,
  setNotice,
}: {
  modelSupportsImages: boolean;
  modelName: string | undefined;
  setNotice: (notice: string | null) => void;
}) {
  const [attachments, setAttachments] = useState<api.AttachmentRef[]>([]);

  const addAttachments = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const rejected = paths
        .filter((path) => utils.isImagePath(path) && !modelSupportsImages)
        .map((path) => utils.getBasename(path));
      const accepted = paths.filter(
        (path) => !(utils.isImagePath(path) && !modelSupportsImages)
      );
      setAttachments((previous) => {
        const known = new Set(previous.map((a) => a.path));
        const next = [...previous];
        for (const path of accepted) {
          if (known.has(path)) continue;
          known.add(path);
          next.push({
            path,
            name: utils.getBasename(path),
            isImage: utils.isImagePath(path),
          });
        }
        return next;
      });
      setNotice(
        rejected.length > 0
          ? `${modelName ?? "This model"} cannot read images: ${rejected.join(", ")}`
          : null
      );
    },
    [modelSupportsImages, modelName, setNotice]
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        addAttachments(event.payload.paths ?? []);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [addAttachments]);

  const pickFiles = useCallback(
    async (imagesOnly: boolean) => {
      const selected = await openDialog({
        multiple: true,
        filters: imagesOnly
          ? [{ name: "Images", extensions: [...utils.IMAGE_EXTENSIONS] }]
          : undefined,
      });
      if (!selected) return;
      addAttachments(Array.isArray(selected) ? selected : [selected]);
    },
    [addAttachments]
  );

  const removeAttachment = useCallback((path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  return {
    attachments,
    setAttachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
    pickFiles,
  };
}
