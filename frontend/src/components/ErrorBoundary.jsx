import { Component } from 'react';

import AppFailureState from '@/app/AppFailureState';
import { publishRuntimeDiagnostics } from '@/lib/runtime-diagnostics';

/**
 * ErrorBoundary component to catch and handle React errors gracefully
 * Prevents the entire app from crashing when a component throws an error
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      diagnostics: null,
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to console in development
    console.error('Error caught by boundary:', error, errorInfo);

    // You can also log to an error reporting service here
    this.setState({
      errorInfo,
      diagnostics: publishRuntimeDiagnostics(),
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, diagnostics: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <AppFailureState
          title="Something went wrong"
          description="An unexpected frontend error occurred. Try again, or reload HMS if the problem persists."
          error={this.state.error}
          diagnostics={this.state.diagnostics}
          onPrimaryAction={this.handleReset}
          primaryActionLabel="Try Again"
        />
      );
    }

    return this.props.children;
  }
}
