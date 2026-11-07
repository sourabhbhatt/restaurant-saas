import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge, statusToneToBadgeVariant, type StatusTone } from "./status-badge";

describe("StatusBadge", () => {
  it.each<[StatusTone, string]>([
    ["neutral", "secondary"],
    ["info", "info"],
    ["success", "success"],
    ["warning", "warning"],
    ["danger", "destructive"],
  ])("maps the %s tone to the %s badge variant", (tone, variant) => {
    render(<StatusBadge tone={tone}>Status</StatusBadge>);

    const badge = screen.getByText("Status");
    expect(badge).toHaveAttribute("data-slot", "badge");
    expect(badge).toHaveAttribute("data-tone", tone);
    expect(badge).toHaveAttribute("data-variant", variant);
    expect(statusToneToBadgeVariant[tone]).toBe(variant);
  });

  it("renders a decorative dot that does not change the accessible text", () => {
    render(
      <StatusBadge tone="success" dot pulse>
        Ready
      </StatusBadge>,
    );

    const badge = screen.getByText("Ready");
    expect(badge).toHaveTextContent(/^Ready$/);
    expect(badge.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});
