import { IS_MAC } from "../../lib/utils";

export function TrafficSpacer() {
  return IS_MAC ? <div className="traffic" data-tauri-drag-region /> : null;
}
