import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageThread } from "@/components/MessageThread";
import type { Message, ReactionSummary } from "@/lib/types";

function setup() {
  const onSend = jest.fn().mockResolvedValue(undefined);
  const utils = render(<MessageThread messages={[]} onSend={onSend} />);
  return { onSend, ...utils };
}

function msg(id: string, body: string): Message {
  return {
    id,
    workspace: "demo",
    author: "human",
    kind: "note",
    body,
    createdAt: "2026-06-04T00:00:00.000Z",
  };
}

function kindMsg(id: string, body: string, kind: Message["kind"]): Message {
  return {
    ...msg(id, body),
    kind,
  };
}

function reactedMsg(
  id: string,
  body: string,
  reactions: ReactionSummary[],
  createdAt = "2026-06-04T00:00:00.000Z",
): Message {
  return {
    ...msg(id, body),
    createdAt,
    reactions,
  };
}

describe("MessageThread", () => {
  test("Cmd+Enter submits message without clicking Send button", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const textarea = screen.getByPlaceholderText("Reply to the agent…");

    await user.type(textarea, "hello agent");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello agent");
    expect(textarea).toHaveValue("");
  });

  test("Ctrl+Enter submits message without clicking Send button", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const textarea = screen.getByPlaceholderText("Reply to the agent…");

    await user.type(textarea, "hello again");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello again");
    expect(textarea).toHaveValue("");
  });

  test("plain Enter does not submit and inserts a newline", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const textarea = screen.getByPlaceholderText("Reply to the agent…");

    await user.type(textarea, "line one{enter}line two");

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("line one\nline two");
  });

  test("scrolls to the latest message when new messages are added via SSE or send", () => {
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const onSend = jest.fn().mockResolvedValue(undefined);
    const first = msg("m1", "first message");
    const { rerender } = render(
      <MessageThread messages={[first]} onSend={onSend} />,
    );

    scrollIntoView.mockClear();

    // Re-render with the same messages: count is unchanged, so no scroll.
    rerender(<MessageThread messages={[first]} onSend={onSend} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    // A 2nd message arrives (e.g. via SSE or after send) — scroll to it.
    const second = msg("m2", "second message");
    rerender(<MessageThread messages={[first, second]} onSend={onSend} />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "nearest",
    });

    // The scroll target is the element rendering the last message.
    const target = scrollIntoView.mock.instances[0] as HTMLElement;
    expect(target).toHaveTextContent("second message");
  });

  test("filters messages by kind", async () => {
    const user = userEvent.setup();
    render(
      <MessageThread
        messages={[
          kindMsg("m1", "preflight result", "check"),
          kindMsg("m2", "final proof", "proof"),
        ]}
        onSend={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText("preflight result")).toBeInTheDocument();
    expect(screen.getByText("final proof")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter"), "proof");

    expect(screen.queryByText("preflight result")).toBeNull();
    expect(screen.getByText("final proof")).toBeInTheDocument();
  });

  test("renders reaction chips with emoji and count from messages[].reactions", () => {
    render(
      <MessageThread
        messages={[
          reactedMsg("m1", "ship it", [
            { emoji: "👍", count: 2, mine: true },
            { emoji: "🎉", count: 1 },
          ]),
        ]}
        onSend={jest.fn().mockResolvedValue(undefined)}
        onReact={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    const thumbsChip = screen.getByRole("button", {
      name: /2 👍 reactions, including yours/,
    });
    expect(thumbsChip).toHaveTextContent("👍");
    expect(thumbsChip).toHaveTextContent("2");
    expect(thumbsChip).toHaveAttribute("aria-pressed", "true");

    const partyChip = screen.getByRole("button", { name: /1 🎉 reaction\b/ });
    expect(partyChip).toHaveTextContent("🎉");
    expect(partyChip).toHaveTextContent("1");
    expect(partyChip).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking an existing reaction chip calls onReact(messageId, emoji) once", async () => {
    const user = userEvent.setup();
    const onReact = jest.fn().mockResolvedValue(undefined);
    render(
      <MessageThread
        messages={[reactedMsg("m1", "ship it", [{ emoji: "👍", count: 1 }])]}
        onSend={jest.fn().mockResolvedValue(undefined)}
        onReact={onReact}
      />,
    );

    await user.click(screen.getByRole("button", { name: /1 👍 reaction\b/ }));

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact).toHaveBeenCalledWith("m1", "👍");
  });

  test("clicking an add-reaction control calls onReact(messageId, emoji) once", async () => {
    const user = userEvent.setup();
    const onReact = jest.fn().mockResolvedValue(undefined);
    render(
      <MessageThread
        messages={[reactedMsg("m1", "ship it", [])]}
        onSend={jest.fn().mockResolvedValue(undefined)}
        onReact={onReact}
      />,
    );

    await user.click(screen.getByRole("button", { name: "React with ✅" }));

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact).toHaveBeenCalledWith("m1", "✅");
  });

  test("reaction controls are hidden when onReact is undefined", () => {
    render(
      <MessageThread
        messages={[reactedMsg("m1", "ship it", [{ emoji: "👍", count: 3 }])]}
        onSend={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByRole("group", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: /👍 reaction/ })).toBeNull();
  });

  test("reaction controls are hidden in read-only mode even with onReact", () => {
    render(
      <MessageThread
        messages={[reactedMsg("m1", "ship it", [{ emoji: "👍", count: 3 }])]}
        onSend={jest.fn().mockResolvedValue(undefined)}
        onReact={jest.fn().mockResolvedValue(undefined)}
        readOnly
      />,
    );

    expect(screen.queryByRole("group", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: /reaction/ })).toBeNull();
  });

  test("renders the unread divider before the first message newer than firstUnreadAt", () => {
    render(
      <MessageThread
        messages={[
          reactedMsg("m1", "old message", [], "2026-06-04T00:00:00.000Z"),
          reactedMsg("m2", "new message", [], "2026-06-05T00:00:00.000Z"),
        ]}
        onSend={jest.fn().mockResolvedValue(undefined)}
        firstUnreadAt="2026-06-04T12:00:00.000Z"
      />,
    );

    const divider = screen.getByRole("separator", { name: "New messages" });
    expect(divider).toBeInTheDocument();

    // The divider must sit immediately before the first unread message ("m2")
    // and after the already-seen one ("m1").
    const log = screen.getByRole("log");
    const labels = within(log)
      .getAllByText(/old message|new message|New/)
      .map((el) => el.textContent);
    const newIndex = labels.findIndex((t) => t === "New");
    const newMsgIndex = labels.findIndex((t) => t === "new message");
    expect(newIndex).toBeGreaterThanOrEqual(0);
    expect(newIndex).toBeLessThan(newMsgIndex);
  });

  test("renders no unread divider when firstUnreadAt is null", () => {
    render(
      <MessageThread
        messages={[
          reactedMsg("m1", "old message", [], "2026-06-04T00:00:00.000Z"),
          reactedMsg("m2", "new message", [], "2026-06-05T00:00:00.000Z"),
        ]}
        onSend={jest.fn().mockResolvedValue(undefined)}
        firstUnreadAt={null}
      />,
    );

    expect(screen.queryByRole("separator", { name: "New messages" })).toBeNull();
  });
});
