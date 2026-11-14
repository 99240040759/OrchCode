import { LuChevronDown } from "react-icons/lu";
import { useChatStore } from "../../lib/store";
import { Button } from "../ui/Button";
import { Menu, MenuContent, MenuItem, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from "../ui/Menu";

const EFFORTS = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
] as const;

export function ModelMenu() {
  const models = useChatStore((s) => s.models);
  const selected = useChatStore((s) => s.selectedModel);
  const setModel = useChatStore((s) => s.setSelectedModel);
  const effort = useChatStore((s) => s.thinkingEffort);
  const setEffort = useChatStore((s) => s.setThinkingEffort);
  const effortLabel = EFFORTS.find((e) => e.key === effort)?.label ?? "High";

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" aria-label="Choose model">
          <span>{selected?.name ?? "Select model"}</span>
          <span className="model-effort">{effortLabel}</span>
          <LuChevronDown />
        </Button>
      </MenuTrigger>
      <MenuContent align="start" side="top">
        {models.length === 0 && <MenuItem disabled>No models available</MenuItem>}
        {models.map((model) => (
          <MenuSub key={model.key}>
            <MenuSubTrigger
              selected={model.key === selected?.key}
              meta={model.badge ? <span className="badge">{model.badge}</span> : undefined}
              onClick={() => model.key !== selected?.key && setModel(model.key)}
            >
              <span className="row-label">{model.name}</span>
            </MenuSubTrigger>
            <MenuSubContent>
              {EFFORTS.map((level) => (
                <MenuItem
                  key={level.key}
                  selected={model.key === selected?.key && effort === level.key}
                  onSelect={() => {
                    setModel(model.key);
                    setEffort(level.key);
                  }}
                >
                  <span className="row-label">{level.label}</span>
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        ))}
      </MenuContent>
    </Menu>
  );
}
