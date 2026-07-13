import { Component, ErrorInfo, ReactNode } from 'react'
import * as Sentry from '@sentry/electron/renderer'
interface Props {
  children: ReactNode
  fallback: ReactNode | ((props: { error: Error; reset: () => void }) => ReactNode)
}
interface State {
  error: Error | null
}
export class ErrorBoundary extends Component<Props, State> {
  public state: State = { error: null }
  public static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    Sentry.captureException(error, { extra: { errorInfo } })
  }
  public reset = (): void => this.setState({ error: null })
  public render(): ReactNode {
    if (this.state.error) {
      if (typeof this.props.fallback === 'function')
        return this.props.fallback({ error: this.state.error, reset: this.reset })
      return this.props.fallback
    }
    return this.props.children
  }
}
