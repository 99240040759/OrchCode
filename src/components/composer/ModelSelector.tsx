import * as api from "../../lib/api";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";

export interface ModelSelectorProps {
  models: api.ModelDto[];
  selectedModel: api.ModelDto | null;
  setSelectedModel: (key: string) => void;
  align?: "start" | "end";
}

export function ModelSelector({
  models,
  selectedModel,
  setSelectedModel,
  align = "start",
}: ModelSelectorProps) {
  return (
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
            {model.badge && (
              <span className="Composer-badge">{model.badge}</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
