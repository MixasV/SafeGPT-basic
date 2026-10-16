interface PagePlaceholderProps {
  title: string;
  description: string;
  sprint: string;
  items?: readonly string[];
}

/**
 * Renders an honest "not built yet" panel for routes whose feature ships in a
 * later sprint. It never fakes data or disables a control silently — the panel
 * states exactly what is missing and when it arrives.
 */
export function PagePlaceholder({ title, description, sprint, items = [] }: PagePlaceholderProps) {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
        <p className="mt-2 text-text-secondary">{description}</p>
      </header>

      <div className="rounded-xl border border-border bg-bg-secondary p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Scheduled for {sprint}
        </p>
        {items.length > 0 && (
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-text-secondary">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}