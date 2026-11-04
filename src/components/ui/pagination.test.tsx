import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination, getPaginationItems } from "./pagination";

const pages = (items: ReturnType<typeof getPaginationItems>) =>
  items.map((item) => (item.type === "page" ? item.page : "…"));

describe("getPaginationItems", () => {
  it("lists every page when they fit", () => {
    expect(pages(getPaginationItems(2, 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it("adds ellipses around the current page", () => {
    expect(pages(getPaginationItems(1, 10))).toEqual([1, 2, 3, 4, 5, "…", 10]);
    expect(pages(getPaginationItems(5, 10))).toEqual([1, "…", 4, 5, 6, "…", 10]);
    expect(pages(getPaginationItems(10, 10))).toEqual([1, "…", 6, 7, 8, 9, 10]);
  });

  it("returns nothing for zero pages", () => {
    expect(getPaginationItems(1, 0)).toEqual([]);
  });
});

describe("Pagination", () => {
  it("renders a labelled navigation with the current page marked", () => {
    render(<Pagination page={3} pageCount={5} onPageChange={() => {}} />);

    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Page 2" })).not.toHaveAttribute("aria-current");
  });

  it("calls onPageChange for previous, next and page buttons", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={3} pageCount={5} onPageChange={onPageChange} />);

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Page 5" }));

    expect(onPageChange.mock.calls).toEqual([[2], [4], [5]]);
  });

  it("does not report the current page again", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={3} pageCount={5} onPageChange={onPageChange} />);

    await user.click(screen.getByRole("button", { name: "Page 3" }));

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("disables previous on the first page and next on the last page", () => {
    const { rerender } = render(<Pagination page={1} pageCount={3} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    rerender(<Pagination page={3} pageCount={3} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows a status for small screens and renders nothing without pages", () => {
    const { container, rerender } = render(
      <Pagination page={2} pageCount={4} onPageChange={() => {}} />,
    );
    expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();

    rerender(<Pagination page={1} pageCount={0} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disables everything when disabled", () => {
    render(<Pagination page={2} pageCount={3} onPageChange={() => {}} disabled />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
