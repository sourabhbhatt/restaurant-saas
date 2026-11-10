import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionStatus } from "./connection-status";

describe("ConnectionStatus", () => {
  it("stays an announced status on phones in compact form (dot only, label for screen readers)", () => {
    render(<ConnectionStatus status="reconnecting" compact />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Polling");
    const label = screen.getByText("Polling");
    expect(label).toHaveClass("max-sm:sr-only");
    expect(status).not.toHaveClass("max-sm:hidden");
  });

  it("shows the label everywhere by default", () => {
    render(<ConnectionStatus status="live" />);
    expect(screen.getByText("Live")).not.toHaveClass("max-sm:sr-only");
  });
});
