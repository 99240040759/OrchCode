import React from "react";
import { VscChevronDown } from "react-icons/vsc";
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

const EFFORT_LEVELS = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
] as const;

export const ModelSelector = React.memo(function ModelSelector({
  models,
  selectedModel,
  setSelectedModel,
  align = "start",
}: ModelSelectorProps) {
  const thinkingEffort = useChatStore((s) => s.thinkingEffort);
  const setThinkingEffort = useChatStore((s) => s.setThinkingEffort);

  const supportsThinking = selectedModel?.capabilities.includes("thinking") ?? false;
  const activeEffortLabel =
    EFFORT_LEVELS.find((e) => e.key === thinkingEffort)?.label ?? "High";

  return (
    <div className="Composer-modelGroup">
      <DropdownMenu>
        <Tooltip content="Select AI model" side="top">
          <DropdownMenuTrigger asChild>
            <Button className="Composer-model">
              <span className="Composer-modelName">{selectedModel?.name ?? "Select model"}</span>
              {selectedModel?.badge && (
                <span className="Composer-badge">{selectedModel.badge}</span>
              )}
              <VscChevronDown className="Composer-chevron" />
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
          <Tooltip content="Reasoning effort" side="top">
            <DropdownMenuTrigger asChild>
              <Button
                className="Composer-model Composer-modelEffort"
                aria-label={`Reasoning effort: ${activeEffortLabel}`}
              >
                <span className="Composer-effortLabel">{activeEffortLabel}</span>
                <VscChevronDown className="Composer-chevron" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent sideOffset={6} align={align}>
            {EFFORT_LEVELS.map((effort) => (
              <DropdownMenuItem
                key={effort.key}
                data-selected={thinkingEffort === effort.key || undefined}
                onSelect={() => setThinkingEffort(effort.key)}
              >
                <span className="ModelItem-name">{effort.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});
