import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageThread } from "@/components/MessageThread";
import type { Message } from "@/lib/types";

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
});
