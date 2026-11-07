import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders a button and handles clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Accept order</Button>);

    await userEvent.click(screen.getByRole("button", { name: "Accept order" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire clicks when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Accept order
      </Button>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Accept order" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders its child element when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/menu">Open menu</a>
      </Button>,
    );

    expect(screen.getByRole("link", { name: "Open menu" })).toHaveAttribute("data-slot", "button");
  });
});
