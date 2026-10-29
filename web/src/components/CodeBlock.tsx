import type { ReactNode } from "react";

/**
 * Monospace block for shell commands and configuration snippets.
 *
 * Renders children verbatim, so a quick-start that does not match the repo is
 * immediately visible when someone copies it out.
 */
export function CodeBlock({ children, className = "" }: { children: string; className?: string }) {
  return (
    <pre
      className={`overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-bg-tertiary p-5 font-mono text-xs leading-relaxed text-text-secondary ${className}`}
    >
      <code>{children}</code>
    </pre>
  );
}

/** Kept as a component so the two pages share one look. */
export type CodeBlockProps = { children: ReactNode };