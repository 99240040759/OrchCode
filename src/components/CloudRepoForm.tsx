import { useEffect, useState } from "react";
import { errorMessage, listGithubRepos, type GithubRepoDto } from "../lib/api";
import { GITHUB_ID, useConnectorsStore } from "../lib/connectors";
import { ConnectorIcon } from "./icons/ConnectorIcon";
import { GithubStatus } from "./composer/GithubStatus";
import { useWorkspaceStore } from "../lib/workspace";

interface CloudRepoFormProps {
  disabled?: boolean;
  onOpened?: () => void;
}

export function CloudRepoForm({ disabled, onOpened }: CloudRepoFormProps) {
  const openCloudRepo = useWorkspaceStore((s) => s.openCloudRepo);
  const busy = useWorkspaceStore((s) => s.busy);
  const connected = useConnectorsStore((s) => s.github?.connected ?? false);
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<GithubRepoDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = busy || Boolean(disabled);

  useEffect(() => {
    if (!connected) return;
    let stale = false;
    const timer = window.setTimeout(
      () => {
        setRepos(null);
        setError(null);
        listGithubRepos(query.trim())
          .then((list) => {
            if (!stale) setRepos(list);
          })
          .catch((e) => {
            if (stale) return;
            setError(errorMessage(e));
            setRepos([]);
          });
      },
      query ? 300 : 0
    );
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [connected, query]);

  const open = (repo: GithubRepoDto) => {
    if (locked) return;
    void openCloudRepo(repo.url);
    onOpened?.();
  };

  if (!connected) {
    return (
      <div className="Sidebar-footer">
        <GithubStatus />
      </div>
    );
  }

  return (
    <div className="Sidebar-footer">
      <input
        type="text"
        className="SearchInput"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search public repositories"
        aria-label="Search public repositories"
      />
      <div className="RepoList">
        {repos === null && <p className="Sidebar-empty">Loading…</p>}
        {error && <p className="Sidebar-empty">{error}</p>}
        {repos?.length === 0 && !error && <p className="Sidebar-empty">No repositories found.</p>}
        {repos?.map((repo) => (
          <button
            key={repo.fullName}
            type="button"
            className="DropdownMenuItem RepoItem"
            disabled={locked}
            title={repo.description || repo.fullName}
            onClick={() => open(repo)}
          >
            <ConnectorIcon id={GITHUB_ID} />
            <span className="ModelItem-name">{repo.fullName}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
