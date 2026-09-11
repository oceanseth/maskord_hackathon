import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown instead of the subtree when it throws. Keep it specific to the section. */
  fallback: ReactNode;
}

/**
 * Keeps one broken section from taking the window with it.
 *
 * Added for the Maskord Pro tab, whose shelf reads Convex: a client that talks
 * to a deployment where those functions are not published yet throws from a
 * hook, and without a boundary React unmounts the whole tree — a white screen
 * mid-demo instead of one panel saying it is unavailable.
 */
export default class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[maskord] section failed', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
