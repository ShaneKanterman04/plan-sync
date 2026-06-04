import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageThread } from "@/components/MessageThread";

function setup() {
  const onSend = jest.fn().mockResolvedValue(undefined);
  const utils = render(<MessageThread messages={[]} onSend={onSend} />);
  return { onSend, ...utils };
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
});
