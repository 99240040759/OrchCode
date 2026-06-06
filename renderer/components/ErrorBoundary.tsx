import { Component, type ErrorInfo, type ReactNode } from 'react'
import Lottie from 'lottie-react'
import errorAnimation from '../assets/error.json'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo)
  }

  private handleReload = () => {
    window.location.reload()
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container">
          <div className="error-boundary-lottie-wrapper">
            <Lottie animationData={errorAnimation} loop={true} className="error-boundary-lottie" />
          </div>
          <h1 className="error-boundary-title">Something went wrong</h1>
          <p className="error-boundary-subtitle">
            {this.state.error?.message || 'An unexpected application crash has occurred.'}
          </p>
          <button onClick={this.handleReload} className="error-boundary-button">
            Reload Application
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
