import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ViewError } from './ViewError';

export interface ErrorBoundaryProps {
  /** Receives every rendering error; the boundary itself only swaps in the error message. */
  readonly onError: (error: unknown, info: ErrorInfo) => void;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Shows ViewError instead of a blank page when rendering fails. React does not rethrow errors that
 * a boundary catches, so the page's global error listener never sees them; they are reported here.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  override render(): ReactNode {
    return this.state.failed ? <ViewError /> : this.props.children;
  }
}
