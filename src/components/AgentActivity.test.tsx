import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import type { AgentActivity as AgentActivityData } from "@/lib/types";
import { AgentActivity } from "@/components/AgentActivity";

function activity(overrides: Partial<AgentActivityData> = {}): AgentActivityData {
  return { at: null, source: null, liveState: null, agentName: null, ...overrides };
}

describe("AgentActivity", () => {
  test("shows an empty state when there is no activity", () => {
    render(<AgentActivity activity={activity()} />);
    expect(screen.getByText("No agent activity yet")).toBeInTheDocument();
  });

  test("renders 'active' with a relative time for past agent activity", () => {
    render(
      <AgentActivity
        activity={activity({ at: new Date().toISOString(), source: "message" })}
      />,
    );
    expect(screen.getByText(/Agent active/)).toBeInTheDocument();
  });

  test("surfaces a live run's state and agent name", () => {
    render(
      <AgentActivity
        activity={activity({
          at: new Date().toISOString(),
          source: "run",
          liveState: "implementing",
          agentName: "claude",
        })}
      />,
    );
    expect(screen.getByText(/claude: Agent implementing/)).toBeInTheDocument();
  });

  test("card variant renders the labelled region", () => {
    render(
      <AgentActivity
        variant="card"
        activity={activity({ at: new Date().toISOString(), source: "plan" })}
      />,
    );
    expect(
      screen.getByRole("region", { name: /agent activity/i }),
    ).toBeInTheDocument();
  });
});
