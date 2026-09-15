// Jest setup shared across the frontend test suite.
// Adds jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...).
require('@testing-library/jest-dom');

// jsdom doesn't implement ResizeObserver; several components (SqueueDataTable,
// SlurmJobHistory) observe their container to re-fit AG Grid columns. Provide
// a minimal no-op polyfill so those components can mount under Jest.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
