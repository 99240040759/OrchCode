import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { LuX } from "react-icons/lu";
import { errorMessage, listGithubRepos, type GithubRepoDto } from "../../lib/api";
import { GITHUB_ID, useConnectorsStore } from "../../lib/connectors";
import { useWorkspaceStore } from "../../lib/workspace";
import { ConnectorIcon } from "../common/ConnectorIcon";
import { Button, IconButton } from "../ui/Button";
import { OverlayPresence } from "../ui/overlay";
import { useGithubConnect } from "./useGithubConnect";

export const useRepoDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

function useRepoSearch(enabled: boolean, query: string) {
  const [repos, setRepos] = useState<GithubRepoDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    const timer = window.setTimeout(
      () => {
        setRepos(null);
        setError(null);
        listGithubRepos(query.trim()).then(
          (list) => !stale && setRepos(list),
          (e) => {
            if (stale) return;
            setError(errorMessage(e));
            setRepos([]);
          }
        );
      },
      query ? 250 : 0
    );
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [enabled, query]);

  return { repos, error };
}

function ConnectPrompt() {
  const { pending, error, connect } = useGithubConnect();
  return (
    <div className="connect">
      <ConnectorIcon id={GITHUB_ID} />
      <p>Connect your GitHub account to open repositories in a cloud workspace.</p>
      <Button variant="primary" size="lg" disabled={pending} onClick={() => void connect()}>
        {pending ? "Waiting for GitHub…" : error ? "Retry connecting" : "Connect GitHub"}
      </Button>
      {error && <span className="alert">{error}</span>}
    </div>
  );
}

function RepoPicker({ onDone }: { onDone: () => void }) {
  const connected = useConnectorsStore((s) => s.github?.connected ?? false);
  const loaded = useConnectorsStore((s) => s.loaded);
  const openCloudRepo = useWorkspaceStore((s) => s.openCloudRepo);
  const busy = useWorkspaceStore((s) => s.busy);
  const [query, setQuery] = useState("");
  const { repos, error } = useRepoSearch(connected, query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (connected) inputRef.current?.focus();
  }, [connected]);

  if (!loaded) return <div className="empty"><span className="spinner" /></div>;
  if (!connected) return <ConnectPrompt />;

  const open = async (repo: GithubRepoDto) => {
    if (busy) return;
    await openCloudRepo(repo.url);
    onDone();
  };

  return (
    <>
      <div className="dialog-search">
        <input
          ref={inputRef}
          className="field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search repositories"
          aria-label="Search repositories"
          spellCheck={false}
        />
      </div>
      <div className="dialog-list" aria-busy={repos === null}>
        {repos === null && <div className="empty"><span className="spinner" /></div>}
        {error && <div className="empty">{error}</div>}
        {repos?.length === 0 && !error && <div className="empty">No repositories found</div>}
        {repos?.map((repo) => (
          <button key={repo.fullName} type="button" className="row" disabled={busy} onClick={() => void open(repo)}>
            <ConnectorIcon id={GITHUB_ID} />
            <span className="dialog-item">
              <span className="truncate">{repo.fullName}</span>
              {repo.description && <span className="truncate">{repo.description}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="dialog-foot">
        {busy ? (
          <>
            <span className="spinner" />
            <span>Preparing cloud workspace…</span>
          </>
        ) : (
          <span>The repository is cloned into a cloud workspace. Nothing is downloaded to this computer.</span>
        )}
      </div>
    </>
  );
}

export function RepoDialog() {
  const open = useRepoDialog((s) => s.open);
  const setOpen = useRepoDialog((s) => s.setOpen);
  const refresh = useConnectorsStore((s) => s.refresh);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <OverlayPresence />
          <div className="dialog-head">
            <Dialog.Title>Open a GitHub repository</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close" size="sm">
                <LuX />
              </IconButton>
            </Dialog.Close>
          </div>
          <RepoPicker onDone={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
