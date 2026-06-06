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
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100vw',
          height: '100vh',
          backgroundColor: '#121212',
          color: '#ffffff',
          fontFamily: 'var(--font-display)',
          padding: '24px',
          textAlign: 'center',
          boxSizing: 'border-box'
        }}>
          <div style={{ width: 250, height: 250, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Lottie
              animationData={errorAnimation}
              loop={true}
              style={{ width: 250, height: 250 }}
            />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, marginTop: '24px', marginBottom: '8px' }}>Something went wrong</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '400px', margin: '0 auto 24px', lineBreak: 'anywhere' }}>
            {this.state.error?.message || 'An unexpected application crash has occurred.'}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: '10px 20px',
              backgroundColor: 'var(--accent-blue)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13.5px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)'
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-blue)')}
          >
            Reload Application
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
