import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../../ui/button";
import { AboutPanel } from "./about-panel";
import { GatedAction } from "./gated-action";

describe("GatedAction", () => {
  it("disables the control and shows the reason as visible, linked text", () => {
    render(
      <GatedAction reason="You've reached the 3-restaurant limit of your plan.">
        {(gate) => <Button {...gate}>Create restaurant</Button>}
      </GatedAction>,
    );
    const button = screen.getByRole("button", { name: "Create restaurant" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "You've reached the 3-restaurant limit of your plan.",
    );
  });

  it("leaves the control enabled with no reason", async () => {
    const onClick = vi.fn();
    render(
      <GatedAction reason={null}>
        {(gate) => (
          <Button onClick={onClick} {...gate}>
            Create restaurant
          </Button>
        )}
      </GatedAction>,
    );
    const button = screen.getByRole("button", { name: "Create restaurant" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-describedby");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });

  it("can be disabled without a reason (pending)", () => {
    render(
      <GatedAction disabled>{(gate) => <Button {...gate}>Send invitation</Button>}</GatedAction>,
    );
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeDisabled();
  });
});

describe("AboutPanel", () => {
  it("can be hidden and brought back, remembering the choice", async () => {
    window.localStorage.clear();
    const { unmount } = render(
      <AboutPanel storageKey="test" title="About restaurants">
        <p>A restaurant is a brand.</p>
      </AboutPanel>,
    );
    expect(screen.getByText("A restaurant is a brand.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide this explanation" }));
    expect(screen.queryByText("A restaurant is a brand.")).not.toBeInTheDocument();
    unmount();

    render(
      <AboutPanel storageKey="test" title="About restaurants">
        <p>A restaurant is a brand.</p>
      </AboutPanel>,
    );
    expect(screen.queryByText("A restaurant is a brand.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "About restaurants" }));
    expect(screen.getByText("A restaurant is a brand.")).toBeInTheDocument();
  });
});
