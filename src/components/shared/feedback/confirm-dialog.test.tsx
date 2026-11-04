import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";

function Harness(props: Partial<ConfirmDialogProps> & Pick<ConfirmDialogProps, "onConfirm">) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel order #42?"
        description="The kitchen will be notified."
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        {...props}
      />
    </>
  );
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ConfirmDialog", () => {
  it("renders an accessible alert dialog", () => {
    render(<Harness onConfirm={() => {}} />);

    const dialog = screen.getByRole("alertdialog", { name: "Cancel order #42?" });
    expect(dialog).toHaveAccessibleDescription("The kitchen will be notified.");
  });

  it("confirms and closes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Cancel order" }));

    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("closed"));
  });

  it("cancels without confirming", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Keep order" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("shows a pending state until the async action resolves", async () => {
    const user = userEvent.setup();
    const action = deferred();
    render(<Harness onConfirm={() => action.promise} pendingLabel="Cancelling…" />);

    await user.click(screen.getByRole("button", { name: "Cancel order" }));

    const confirm = screen.getByRole("button", { name: "Cancelling…" });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep order" })).toBeDisabled();
    expect(screen.getByRole("alertdialog")).toHaveAttribute("aria-busy", "true");

    // Escape must not dismiss while the action is running.
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("state")).toHaveTextContent("open");

    action.resolve();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("closed"));
  });

  it("keeps the dialog open and shows the error when the action fails", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error("Order already served"));
    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Cancel order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Order already served");
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeEnabled();

    // Retrying clears the error and succeeds.
    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("closed"));
  });

  it("uses a generic message for non-Error rejections and resets on reopen", async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={() => Promise.reject("boom")} />);

    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );

    await user.click(screen.getByRole("button", { name: "Keep order" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("closed"));

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("supports a custom error mapper", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        onConfirm={() => Promise.reject(new Error("SQLSTATE 23505"))}
        getErrorMessage={() => "This order can no longer be cancelled."}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This order can no longer be cancelled.",
    );
    expect(screen.queryByText(/SQLSTATE/)).not.toBeInTheDocument();
  });
});
