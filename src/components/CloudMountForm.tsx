import { useState } from "react";
import { LuCloud } from "react-icons/lu";
import { Button } from "./ui/Button";
import { cn } from "../lib/utils";
import { useWorkspaceStore } from "../lib/workspace";

interface CloudMountFormProps {
  disabled?: boolean;
  onMounted?: () => void;
  compact?: boolean;
}

export function CloudMountForm({ disabled, onMounted, compact }: CloudMountFormProps) {
  const openCloudRepo = useWorkspaceStore((s) => s.openCloudRepo);
  const busy = useWorkspaceStore((s) => s.busy);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const locked = busy || Boolean(disabled);

  const submit = () => {
    const url = repoUrl.trim();
    if (!url || locked) return;
    void openCloudRepo(url, name.trim() || undefined);
    setName("");
    setRepoUrl("");
    onMounted?.();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={cn("CloudMount", compact && "CloudMount-compact")}>
      <input
        type="text"
        className="FilePicker-input"
        value={name}
        disabled={locked}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKey}
        placeholder="Project name (optional)"
        aria-label="Project name"
      />
      <input
        type="url"
        className="FilePicker-input"
        value={repoUrl}
        disabled={locked}
        onChange={(e) => setRepoUrl(e.target.value)}
        onKeyDown={onKey}
        placeholder="https://github.com/owner/repo"
        aria-label="Repository URL"
      />
      <Button className="Sidebar-newchat" disabled={locked || !repoUrl.trim()} onClick={submit}>
        <LuCloud />
        <span>{busy ? "Mounting…" : "Mount"}</span>
      </Button>
    </div>
  );
}
