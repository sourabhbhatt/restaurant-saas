import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("titles a section with an h3 by default", () => {
    render(<EmptyState title="No orders yet" description="New orders show up here." />);
    expect(screen.getByRole("heading", { level: 3, name: "No orders yet" })).toBeInTheDocument();
  });

  it("can be the page's main content right under the h1", () => {
    render(<EmptyState headingLevel={2} title="No tickets right now" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "No tickets right now" }),
    ).toBeInTheDocument();
  });
});
