export function StaleWarning({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <section
      role="status"
      className="mb-4 rounded-card border border-warning bg-warning-subtle p-4 text-sm text-warning-foreground shadow-card"
    >
      <div className="font-semibold">Plan may be stale</div>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {reasons.map((reason) => (
          <li key={reason} className="break-words">
            {reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
