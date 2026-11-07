import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchInput } from "./search-input";

describe("SearchInput", () => {
  it("shows the clear button only when there is a value", async () => {
    const user = userEvent.setup();
    render(<SearchInput aria-label="Search dishes" />);

    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search dishes" }), "pad");

    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
  });

  it("clears an uncontrolled value, refocuses the input and calls callbacks", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onClear = vi.fn();
    render(
      <SearchInput
        aria-label="Search"
        defaultValue="pizza"
        onValueChange={onValueChange}
        onClear={onClear}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    const input = screen.getByRole("searchbox", { name: "Search" });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(onValueChange).toHaveBeenLastCalledWith("");
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("works controlled", async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = useState("");
      return (
        <>
          <SearchInput aria-label="Search" value={value} onValueChange={setValue} />
          <output>{value || "empty"}</output>
        </>
      );
    }
    render(<Controlled />);

    await user.type(screen.getByRole("searchbox"), "tacos");
    expect(screen.getByRole("status")).toHaveTextContent("tacos");

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("status")).toHaveTextContent("empty");
  });

  it("clears with Escape", async () => {
    const user = userEvent.setup();
    render(<SearchInput aria-label="Search" defaultValue="soup" />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    await user.keyboard("{Escape}");

    expect(input).toHaveValue("");
  });

  it("hides the clear button when disabled", () => {
    render(<SearchInput aria-label="Search" defaultValue="soup" disabled />);

    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });
});
