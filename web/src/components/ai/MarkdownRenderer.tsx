import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a ChainGPT response verbatim.
 *
 * The API returns markdown text, not structured data, so this renders it as
 * written rather than reshaping it into fields. That means a change in the
 * model's formatting degrades the layout instead of silently corrupting a value.
 *
 * `code` is rendered as `<pre>` so Solidity keeps its whitespace — collapsing it
 * would make generated contracts uncopyable.
 */
export function MarkdownRenderer({ markdown, className = "" }: { markdown: string; className?: string }) {
  return (
    <div className={`text-sm leading-relaxed text-text-primary ${className}`} data-testid="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold text-text-primary first:mt-0">{children}</h2>,
          h2: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold text-text-primary first:mt-0">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-2 mt-3 font-semibold text-text-primary first:mt-0">{children}</h4>,
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
          a: ({ children, href }) => (
            <a className="text-accent underline underline-offset-2" href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
          code: ({ className: codeClass, children }) =>
            codeClass === undefined ? (
              <code className="rounded bg-bg-tertiary px-1 py-0.5 font-mono text-xs">{children}</code>
            ) : (
              <pre className="mb-3 overflow-x-auto rounded-lg border border-border bg-bg-tertiary p-4">
                <code className="font-mono text-xs leading-relaxed text-text-secondary">{children}</code>
              </pre>
            ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}