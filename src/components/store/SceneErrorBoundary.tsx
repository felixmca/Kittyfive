"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** What to render instead when the subtree throws. */
  fallback: ReactNode;
  /** Name for the console warning. */
  label?: string;
}

interface State {
  failed: boolean;
}

/**
 * Error boundary for 3D subtrees (works inside an R3F Canvas). A broken GLB,
 * a missing texture or a shader that will not compile swaps to the fallback
 * instead of taking the whole room down.
 */
export default class SceneErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn(
      `[store] ${this.props.label ?? "scene"} failed; using fallback`,
      error instanceof Error ? error.message : error,
      info.componentStack ?? "",
    );
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
