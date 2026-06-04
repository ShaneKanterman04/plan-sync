import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangesRequestedModal } from "@/components/ChangesRequestedModal";

function setup(overrides: Partial<Parameters<typeof ChangesRequestedModal>[0]> = {}) {
  const onClose = jest.fn();
  const onSubmit = jest.fn();
  const utils = render(
    <ChangesRequestedModal
      isOpen
      busy={false}
      onClose={onClose}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onClose, onSubmit, ...utils };
}

describe("ChangesRequestedModal", () => {
  test("renders nothing when closed", () => {
    const { queryByRole } = render(
      <ChangesRequestedModal isOpen={false} busy={false} onClose={jest.fn()} onSubmit={jest.fn()} />,
    );
    expect(queryByRole("dialog")).toBeNull();
  });

  test("autofocuses the textarea when opened", () => {
    setup();
    const textarea = screen.getByPlaceholderText("What changes are needed?");
    expect(textarea).toHaveFocus();
  });

  test("accepts multiline input and submits the trimmed note on send", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = setup();
    const textarea = screen.getByPlaceholderText("What changes are needed?");

    await user.type(textarea, "line one{enter}line two");
    expect(textarea).toHaveValue("line one\nline two");

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("line one\nline two");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Ctrl+Enter submits note without clicking Send button", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = setup();
    const textarea = screen.getByPlaceholderText("What changes are needed?");

    await user.type(textarea, "  needs work  ");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("needs work");
    // Modal stays open; the parent closes it via onClose.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("Cmd+Enter submits note without clicking Send button", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = setup();
    const textarea = screen.getByPlaceholderText("What changes are needed?");

    await user.type(textarea, "  fix the bug  ");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("fix the bug");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("calls onClose on cancel without submitting", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("disables both buttons while busy", () => {
    setup({ busy: true });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
