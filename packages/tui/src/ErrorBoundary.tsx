import React from 'react';
import {ErrorFallbackScreen} from './screens/ErrorFallbackScreen.js';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error?: Error;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {error};
  }

  override componentDidCatch(error: Error): void {
    process.stderr.write(`Corvus Skill Manager TUI error: ${error.stack ?? error.message}\n`);
  }

  override render(): React.ReactNode {
    if (this.state.error !== undefined) {
      return <ErrorFallbackScreen error={this.state.error} />;
    }

    return this.props.children;
  }
}
