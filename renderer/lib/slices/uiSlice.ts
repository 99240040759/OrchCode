import { StateCreator } from 'zustand'
import type { ThreadStoreState } from '../threadStore'
import { toast } from '../toast'

export interface UiSlice {
  activeNav: 'Search' | undefined
  artifactOpen: boolean
  showBrowser: boolean
  activeQuestions: { id: string; sessionId: string; question: string; options: string[] }[]
  setActiveNav: (nav: 'Search' | undefined) => void
  setArtifactOpen: (open: boolean) => void
  setShowBrowser: (show: boolean) => void
  submitAnswer: (answer: string) => Promise<void>
}

export const createUiSlice: StateCreator<ThreadStoreState, [], [], UiSlice> = (set, get) => ({
  activeNav: undefined,
  artifactOpen: false,
  showBrowser: false,
  activeQuestions: [],
  setActiveNav: (nav) => set({ activeNav: nav }),
  setArtifactOpen: (open) => set({ artifactOpen: open }),
  setShowBrowser: (show) => set({ showBrowser: show }),
  submitAnswer: async (answer) => {
    const q = get().activeQuestions[0]
    if (!q) return
    const ok = await window.api.submitAnswer({ id: q.id, answer }).catch((err: unknown) => {
      toast.error('Failed to submit answer.', err)
      return false
    })
    if (ok !== false)
      set((state) => ({ activeQuestions: state.activeQuestions.filter((question) => question.id !== q.id) }))
  }
})
