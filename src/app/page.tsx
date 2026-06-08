"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkspaceSummary } from "@/lib/types";
import { api, timeLabel } from "@/components/api";
import { DocumentTypeBadge } from "@/components/DocumentTypeBadge";
import { LoadError } from "@/components/LoadError";
import { StatusBadge } from "@/components/StatusBadge";
import { useLiveReload } from "@/components/useLiveReload";

export default function Home() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ workspaces: WorkspaceSummary[] }>("/api/workspaces");
      setWorkspaces(data.workspaces);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }, []);

  const connectionError = useLiveReload({
    url: "/api/workspaces/events",
    load,
    disconnectMessage: "Live updates disconnected from /api/workspaces/events.",
  });

  function open(e: React.FormEvent) {
    e.preventDefault();
    const slug = name.trim();
    if (slug) router.push(`/w/${encodeURIComponent(slug)}`);
  }

  return (
    <main
      id="main"
      className="mx-auto min-h-[100dvh] max-w-2xl overflow-x-clip px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-10"
    >
      <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border-strong bg-surface/90 px-[max(1rem,env(safe-area-inset-left))] py-3 shadow-raised backdrop-blur">
        <h1 className="text-[1.375rem] font-extrabold leading-7 tracking-tight">plan-sync</h1>
        <p className="text-sm text-muted">Shared plans for agents &amp; humans</p>
      </header>

      <form onSubmit={open} className="mb-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="workspace name (e.g. hostlet)"
          aria-label="Workspace name"
          className="min-h-12 flex-1 rounded-control border border-border-strong bg-surface px-3 text-base text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface focus:border-border-strong placeholder:text-muted"
        />
        <button className="min-h-12 shrink-0 rounded-control bg-primary px-4 text-base font-semibold text-primary-foreground transition active:scale-[0.98] active:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
          Open
        </button>
      </form>

      {error && <LoadError message={error} url="/api/workspaces" onRetry={load} />}
      {connectionError && (
        <p
          role="status"
          className="mb-4 rounded-card border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning-foreground"
        >
          {connectionError} Refreshing on focus is still enabled.
        </p>
      )}

      <nav aria-label="Workspaces">
        <h2 className="sr-only">Workspaces</h2>

        {workspaces === null && (
          <ul className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="rounded-card border border-border bg-surface p-4 shadow-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="h-4 w-28 rounded bg-surface-2 animate-pulse" />
                  <div className="h-5 w-20 rounded-full bg-surface-2 animate-pulse" />
                </div>
                <div className="mt-2 h-3.5 w-40 rounded bg-surface-2 animate-pulse" />
                <div className="mt-2 h-3 w-52 rounded bg-surface-2 animate-pulse" />
              </li>
            ))}
          </ul>
        )}

        {workspaces && workspaces.length > 0 && (
          <ul className="space-y-2">
            {workspaces.map((w) => (
              <li key={w.workspace}>
                <Link
                  href={`/w/${encodeURIComponent(w.workspace)}`}
                  className="row-fade-in block rounded-card border border-border bg-surface p-4 shadow-card transition active:scale-[0.99] active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-base font-semibold text-foreground">
                      {w.workspace}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5 pointer-events-none">
                      <DocumentTypeBadge type={w.documentType} />
                      <StatusBadge status={w.status} />
                    </div>
                  </div>

                  {w.title && (
                    <div className="mt-0.5 truncate text-sm text-muted">{w.title}</div>
                  )}

                  {w.primaryFile && (
                    <div className="mt-1 truncate text-[0.8125rem] text-muted">
                      {w.primaryFile}
                    </div>
                  )}

                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[0.8125rem] text-muted">
                    <span className="min-w-0 truncate">
                      v{w.version} · {w.updatedBy} · {timeLabel(w.updatedAt)}
                    </span>
                    {(w.fileCount > 0 || w.messageCount > 0) && (
                      <span className="shrink-0">
                        {w.fileCount > 0 &&
                          `${w.fileCount} file${w.fileCount === 1 ? "" : "s"}`}
                        {w.fileCount > 0 && w.messageCount > 0 && " · "}
                        {w.messageCount > 0 && `${w.messageCount} msg`}
                      </span>
                    )}
                  </div>

                  {w.staleReasons.length > 0 && (
                    <div className="mt-1.5 text-[0.8125rem] font-semibold text-warning">
                      Stale review metadata
                    </div>
                  )}

                  {w.lastMessagePreview && (
                    <div className="mt-1.5 truncate text-[0.8125rem] italic text-muted">
                      {w.lastMessagePreview}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {workspaces && workspaces.length === 0 && !error && (
          <div className="rounded-card border border-dashed border-border-strong p-6 text-center">
            <p className="text-sm font-semibold text-foreground">No workspaces yet</p>
            <p className="mt-1 text-sm text-muted">
              Open one above, or have an agent post a plan.
            </p>
          </div>
        )}
      </nav>
    </main>
  );
}
