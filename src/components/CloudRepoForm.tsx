import { useState } from "react";
import { LuCloud } from "react-icons/lu";
import { Button } from "./ui/Button";
import { useWorkspaceStore } from "../lib/workspace";

interface CloudRepoFormProps {
  disabled?: boolean;
  onOpened?: () => void;
}

export function CloudRepoForm({ disabled, onOpened }: CloudRepoFormProps) {
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
    onOpened?.();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="Sidebar-footer">
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
        size={30}
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
        <span>{busy ? "Opening…" : "Open"}</span>
      </Button>
    </div>
  );
}
