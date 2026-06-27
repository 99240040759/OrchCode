import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelDef } from '../ipc/types';
interface ModelsState {
  models: Record<string, ModelDef>;
  selectedKey: string;
  isLoaded: boolean;
  setModels: (m: Record<string, ModelDef>) => void;
  setSelectedKey: (k: string) => void;
  selectedModel: () => ModelDef | null;
  opencodeModels: () => [string, ModelDef][];
  zaiModels: () => [string, ModelDef][];
}
export const useModelsStore = create<ModelsState>()(persist((set, get) => ({
  models: {}, selectedKey: '', isLoaded: false,
  setModels: (models) => {
    const entries = Object.entries(models);
    const cur = get().selectedKey;
    const validKey = cur && models[cur] ? cur : (entries.find(([, m]) => m.provider === 'opencode')?.[0] || entries[0]?.[0] || '');
    set({ models, isLoaded: true, selectedKey: validKey });
  },
  setSelectedKey: (k) => set({ selectedKey: k }),
  selectedModel: () => { const s = get(); return s.models[s.selectedKey] || null; },
  opencodeModels: () => Object.entries(get().models).filter(([, m]) => m.provider === 'opencode'),
  zaiModels: () => Object.entries(get().models).filter(([, m]) => m.provider === 'z-ai'),
}), { name: 'models-store', partialize: (s) => ({ selectedKey: s.selectedKey }) }));

