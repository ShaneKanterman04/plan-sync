"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkspaceSummary } from "@/lib/types";
import { api, relativeTime } from "@/components/api";
import { StatusBadge } from "@/components/StatusBadge";

export default function Home() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");

  async function load() {
    try {
      const data = await api<{ workspaces: WorkspaceSummary[] }>("/api/workspaces");
      setWorkspaces(data.workspaces);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  function open(e: React.FormEvent) {
    e.preventDefault();
    const slug = name.trim();
    if (slug) router.push(`/w/${encodeURIComponent(slug)}`);
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-gray-200 bg-white/90 px-4 py-4 backdrop-blur">
        <h1 className="text-xl font-extrabold">plan-sync</h1>
        <p className="text-sm text-gray-500">Shared plans for agents &amp; humans</p>
      </header>

      <form onSubmit={open} className="mb-5 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="workspace name (e.g. hostlet)"
          className="min-h-12 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-base outline-none focus:border-gray-500"
        />
        <button className="min-h-12 rounded-xl bg-gray-900 px-4 text-base font-bold text-white">
          Open
        </button>
      </form>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      <ul className="space-y-2">
        {workspaces.map((w) => (
          <li key={w.workspace}>
            <Link
              href={`/w/${encodeURIComponent(w.workspace)}`}
              className="block rounded-2xl border border-gray-200 bg-white p-4 active:bg-gray-50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{w.workspace}</span>
                <StatusBadge status={w.status} />
              </div>
              {w.title && <div className="mt-0.5 text-sm text-gray-600">{w.title}</div>}
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-400">
                <span>
                  v{w.version} · {w.updatedBy} · {relativeTime(w.updatedAt)}
                </span>
                {w.messageCount > 0 && <span>{w.messageCount} msg</span>}
              </div>
              {w.lastMessagePreview && (
                <div className="mt-1 truncate text-xs text-gray-500">
                  “{w.lastMessagePreview}”
                </div>
              )}
            </Link>
          </li>
        ))}
        {workspaces.length === 0 && !error && (
          <li className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
            No workspaces yet. Open one above, or have an agent post a plan.
          </li>
        )}
      </ul>
    </main>
  );
}
