"use client";
/**
 * Minimal error boundary for the hero. Anything that can fail at runtime
 * (WebGL context creation, a broken GLB, a shader compile) is wrapped in one of
 * these so the page degrades to a designed fallback instead of a blank hole.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  fallback: ReactNode;
  children: ReactNode;
  /** Short name used in the dev-only console warning. */
  label?: string;
  onError?: (error: unknown) => void;
}

interface State {
  failed: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[hero] ${this.props.label ?? "subtree"} failed; rendering its fallback.`,
        error,
        info.componentStack,
      );
    }
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
