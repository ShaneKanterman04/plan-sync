export function LoadError({
  message,
  url,
  onRetry,
}: {
  message: string;
  url: string;
  onRetry: () => void;
}) {
  return (
    <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
      <div className="font-bold">Could not load plan-sync data.</div>
      <div className="mt-1">{message}</div>
      <div className="mt-1 break-all text-xs text-rose-700">Endpoint: {url}</div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-bold text-rose-800"
      >
        Retry
      </button>
    </div>
  );
}
