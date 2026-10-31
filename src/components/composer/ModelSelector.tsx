import React from "react";
import * as api from "../../lib/api";
import { useChatStore } from "../../lib/store";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";

interface ModelSelectorProps {
  models: api.ModelDto[];
  selectedModel: api.ModelDto | null;
  setSelectedModel: (key: string) => void;
  align?: "start" | "end";
}

export const ModelSelector = React.memo(function ModelSelector({
  models,
  selectedModel,
  setSelectedModel,
  align = "start",
}: ModelSelectorProps) {
  const thinkingEffort = useChatStore((s) => s.thinkingEffort);
  const setThinkingEffort = useChatStore((s) => s.setThinkingEffort);

  React.useEffect(() => {
    if (thinkingEffort !== "high") {
      setThinkingEffort("high");
    }
  }, [thinkingEffort, setThinkingEffort]);

  const supportsThinking = selectedModel?.capabilities.includes("thinking") ?? false;

  return (
    <div className="Composer-modelGroup">
      <DropdownMenu>
        <Tooltip content="Select AI model" side="top">
          <DropdownMenuTrigger asChild>
            <Button className="Composer-model">
              <span className="Composer-modelName">{selectedModel?.name ?? "Model"}</span>
              {selectedModel?.badge && (
                <span className="Composer-badge">{selectedModel.badge}</span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent sideOffset={6} align={align}>
          {models.length === 0 && (
            <DropdownMenuItem disabled>No models available</DropdownMenuItem>
          )}
          {models.map((model) => (
            <DropdownMenuItem
              key={model.key}
              data-selected={model.key === selectedModel?.key || undefined}
              onSelect={() => setSelectedModel(model.key)}
            >
              <span className="ModelItem-name">{model.name}</span>
              {model.badge && <span className="Composer-badge">{model.badge}</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {supportsThinking && (
        <DropdownMenu>
          <Tooltip content="Select effort" side="top">
            <DropdownMenuTrigger asChild>
              <Button className="Composer-model Composer-modelEffort" aria-label={`Effort: ${thinkingEffort}`}>
                <span className="Composer-effortLabel">
                  {thinkingEffort[0].toUpperCase() + thinkingEffort.slice(1)}
                </span>
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent sideOffset={6} align={align}>
            {["low", "medium", "high"].map((effort) => {
              const isDisabled = effort !== "high";
              return (
                <DropdownMenuItem
                  key={effort}
                  disabled={isDisabled}
                  data-selected={thinkingEffort === effort || undefined}
                  onSelect={() => !isDisabled && setThinkingEffort(effort)}
                >
                  <span className="ModelItem-name">{effort[0].toUpperCase() + effort.slice(1)}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});
