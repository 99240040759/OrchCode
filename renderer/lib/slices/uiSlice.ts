import { StateCreator } from 'zustand'
import type { ThreadStoreState } from '../threadStore'
import { toast } from '../toast'

export interface UiSlice {
  activeNav: 'new' | 'Search' | undefined
  artifactOpen: boolean
  showBrowser: boolean
  activeQuestion: { id: string; sessionId: string; question: string; options: string[] } | undefined
  setActiveNav: (nav: 'new' | 'Search' | undefined) => void
  setArtifactOpen: (open: boolean) => void
  setShowBrowser: (show: boolean) => void
  submitAnswer: (answer: string) => Promise<void>
}

export const createUiSlice: StateCreator<ThreadStoreState, [], [], UiSlice> = (set, get) => ({
  activeNav: undefined,
  artifactOpen: false,
  showBrowser: false,
  activeQuestion: undefined,
  setActiveNav: (nav) => set({ activeNav: nav }),
  setArtifactOpen: (open) => set({ artifactOpen: open }),
  setShowBrowser: (show) => set({ showBrowser: show }),
  submitAnswer: async (answer) => {
    const q = get().activeQuestion
    if (!q) return
    set({ activeQuestion: undefined })
    await window.api.submitAnswer({ id: q.id, answer }).catch((err: unknown) => {
      toast.error('Failed to submit answer.', err)
    })
  }
})
