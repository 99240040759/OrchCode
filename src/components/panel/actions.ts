import { useArtifactsStore } from "../../lib/artifacts";
import { transition } from "../ui/transition";

const store = () => useArtifactsStore.getState();

function whenClosed(update: () => void) {
  if (store().panelOpen) update();
  else transition(update);
}

export const openArtifact = (path: string) => whenClosed(() => store().openFile(path));
export const openBrowser = (url?: string) => whenClosed(() => store().openBrowser(url));
export const openTerminal = () => whenClosed(() => store().openTerminal());
export const fileWritten = (path: string) => whenClosed(() => store().fileWritten(path));

export function showExplorer() {
  const { panelOpen, explorerOpen } = store();
  if (panelOpen && explorerOpen) return;
  transition(() => store().showExplorer());
}

export const togglePanel = () => transition(() => store().setPanelOpen(!store().panelOpen));
export const toggleMaximized = () => transition(() => store().toggleMaximized());
export const toggleExplorer = () => transition(() => store().toggleExplorer());

export function closeTab(id: string) {
  if (store().tabs.length === 1) transition(() => store().closeTab(id));
  else store().closeTab(id);
}
