export function LoadError({
  message,
  url,
  onRetry,
  heading = "Could not load plan-sync data.",
}: {
  message: string;
  url: string;
  onRetry: () => void;
  heading?: string;
}) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-card border border-danger bg-danger-subtle p-4 text-sm text-danger-foreground shadow-card"
    >
      <div className="font-semibold">{heading}</div>
      <div className="mt-1">{message}</div>
      <div className="mt-1 break-all text-xs text-danger-foreground/80">
        Endpoint: {url}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 min-h-11 rounded-control border border-border-strong bg-surface px-4 text-base font-semibold text-danger-foreground transition active:scale-[0.98] active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
      >
        Retry
      </button>
    </div>
  );
}
