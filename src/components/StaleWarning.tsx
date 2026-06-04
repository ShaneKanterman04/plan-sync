export function StaleWarning({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <section className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
      <div className="font-bold">Plan may be stale</div>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </section>
  );
}
