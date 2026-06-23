import type { AgentActivity as AgentActivityData, PluginRunState } from "@/lib/types";
import { relativeTime, timeLabel } from "@/components/api";

// How recent counts as "active now" (drives the green pulsing dot) when there is
// no in-flight plugin run to key off: 10 minutes.
const RECENT_MS = 10 * 60 * 1000;

const RUN_STATE_LABELS: Record<PluginRunState, string> = {
  waiting: "waiting for approval",
  approved: "approved, starting",
  preflight: "running preflight",
  implementing: "implementing",
  interrupted: "interrupted",
  failed: "failed",
  done: "done",
};

function isRecent(at: string | null): boolean {
  if (!at) return false;
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms < RECENT_MS;
}

/**
 * Compact "when did an agent last touch this workspace" indicator. Two shapes:
 *   - `inline`  → a dot + one line, for list rows and headers.
 *   - `card`    → a bordered panel with a heading, for the workspace sidebar.
 *
 * The dot pulses green while a plugin run is in flight (or activity is very
 * recent), sits solid green when recent, and dims to muted once it's stale.
 */
export function AgentActivity({
  activity,
  variant = "inline",
}: {
  activity: AgentActivityData;
  variant?: "inline" | "card";
}) {
  const live = activity.liveState !== null;
  const active = live || isRecent(activity.at);

  let label: string;
  if (live && activity.liveState) {
    // e.g. "claude: Agent implementing · 2m ago" (name prefix only when known).
    const state = RUN_STATE_LABELS[activity.liveState] ?? activity.liveState;
    const who = activity.agentName ? `${activity.agentName}: ` : "";
    const when = activity.at ? ` · ${relativeTime(activity.at)}` : "";
    label = `${who}Agent ${state}${when}`;
  } else if (activity.at) {
    label = `Agent active ${relativeTime(activity.at)}`;
  } else {
    label = "No agent activity yet";
  }

  const dot = (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden="true">
      {live && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
      )}
      <span
        className={`relative inline-flex size-2 rounded-full ${
          active ? "bg-accent" : "bg-muted/50"
        }`}
      />
    </span>
  );

  if (variant === "card") {
    return (
      <section
        aria-label="Agent activity"
        className="rounded-card border border-border bg-surface p-4 shadow-card"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Agent activity
        </h2>
        <div className="mt-2 flex items-center gap-2">
          {dot}
          <span
            className={`text-sm font-semibold ${active ? "text-foreground" : "text-muted"}`}
          >
            {label}
          </span>
        </div>
        {activity.at && (
          <p className="mt-1 pl-4 text-[0.75rem] leading-4 text-muted">
            {timeLabel(activity.at)}
          </p>
        )}
      </section>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[0.8125rem] leading-[18px] ${
        active ? "text-foreground" : "text-muted"
      }`}
    >
      {dot}
      {label}
    </span>
  );
}
