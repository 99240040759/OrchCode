import React from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import * as api from "../../lib/api";
import { useChatStore } from "../../lib/store";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";

interface ModelSelectorProps {
  models: api.ModelDto[];
  selectedModel: api.ModelDto | null;
  setSelectedModel: (key: string) => void;
  align?: "start" | "end";
}

const CLOUD_PROVIDER = "antigravity";

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

  const activeEffortLabel =
    EFFORT_LEVELS.find((e) => e.key === thinkingEffort)?.label ?? "High";
  const selectedHasEffort = selectedModel?.provider !== CLOUD_PROVIDER;

  return (
    <div className="Composer-modelGroup">
      <DropdownMenu>
        <Tooltip
          content={
            selectedHasEffort
              ? `Model: ${selectedModel?.name ?? "Select model"} · Thinking: ${activeEffortLabel}`
              : `Model: ${selectedModel?.name ?? "Select model"}`
          }
          side="top"
        >
          <DropdownMenuTrigger asChild>
            <Button className="Composer-model">
              <span className="Composer-modelName">{selectedModel?.name ?? "Select model"}</span>
              {selectedHasEffort && (
                <span className="Composer-effortLabel">· {activeEffortLabel}</span>
              )}
              <LuChevronDown className="Composer-chevron" />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent sideOffset={6} align={align}>
          {models.length === 0 && (
            <DropdownMenuItem disabled>No models available</DropdownMenuItem>
          )}
          {models.map((model) =>
            model.provider === CLOUD_PROVIDER ? (
              <DropdownMenuItem
                key={model.key}
                data-selected={model.key === selectedModel?.key || undefined}
                onSelect={() => setSelectedModel(model.key)}
              >
                <span className="ModelItem-name">{model.name}</span>
                {model.badge && <span className="Composer-badge">{model.badge}</span>}
              </DropdownMenuItem>
            ) : (
            <DropdownMenuSub key={model.key}>
              <DropdownMenuSubTrigger
                data-selected={model.key === selectedModel?.key || undefined}
                onClick={() => {
                  if (model.key !== selectedModel?.key) {
                    setSelectedModel(model.key);
                  }
                }}
              >
                <span className="ModelItem-name">{model.name}</span>
                {model.badge && <span className="Composer-badge">{model.badge}</span>}
                <LuChevronRight className="DropdownMenuSubTrigger-chevron" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent sideOffset={6}>
                {EFFORT_LEVELS.map((effort) => (
                  <DropdownMenuItem
                    key={effort.key}
                    data-selected={
                      model.key === selectedModel?.key && thinkingEffort === effort.key
                        ? true
                        : undefined
                    }
                    onSelect={() => {
                      setSelectedModel(model.key);
                      setThinkingEffort(effort.key);
                    }}
                  >
                    <span className="ModelItem-name">{effort.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
