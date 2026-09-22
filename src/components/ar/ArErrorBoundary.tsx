"use client";
/**
 * Catches render and runtime errors in a subtree so a lost WebGL context, a
 * throwing hook or a bad frame never blanks the try-on page. Used around the
 * R3F canvas and around the whole TryOn component.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** What to render instead. Defaults to nothing (the layer just disappears). */
  fallback?: ReactNode;
  /** For the console message only. */
  label?: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class ArErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[ar] ${this.props.label ?? "subtree"} failed`, error, info.componentStack);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
