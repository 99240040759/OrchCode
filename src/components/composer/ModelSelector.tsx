import React from "react";
import { VscCheck } from "react-icons/vsc";
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

  return (
    <>
      <DropdownMenu>
        <Tooltip content="Select AI model" side="top">
          <DropdownMenuTrigger asChild>
            <Button className="Composer-model">
              <span>{selectedModel?.name ?? "Model"}</span>
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
              onSelect={() => setSelectedModel(model.key)}
            >
              <span className="ModelItem-name">{model.name}</span>
              {model.badge && <span className="Composer-badge">{model.badge}</span>}
              {model.key === selectedModel?.key && <VscCheck aria-label="Selected" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedModel?.capabilities.includes("thinking") && (
        <DropdownMenu>
          <Tooltip content="Select effort" side="top">
            <DropdownMenuTrigger asChild>
              <Button className="Composer-model" aria-label={`Effort: ${thinkingEffort}`}>
                <span>{thinkingEffort[0].toUpperCase() + thinkingEffort.slice(1)}</span>
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
                  onSelect={() => !isDisabled && setThinkingEffort(effort)}
                >
                  <span className="ModelItem-name">{effort[0].toUpperCase() + effort.slice(1)}</span>
                  {thinkingEffort === effort && <VscCheck aria-label="Selected" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
});
