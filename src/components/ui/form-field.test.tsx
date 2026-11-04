import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormField } from "./form-field";
import { Input } from "./input";

describe("FormField", () => {
  it("links the label to the control", () => {
    render(
      <FormField label="Email">
        <Input type="email" />
      </FormField>,
    );

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("describes the control with its description", () => {
    render(
      <FormField label="Email" description="We'll send the receipt here.">
        <Input />
      </FormField>,
    );

    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "We'll send the receipt here.",
    );
  });

  it("marks the control invalid and announces the error", () => {
    render(
      <FormField label="Email" description="Work address" error="Enter a valid email">
        <Input />
      </FormField>,
    );

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Work address Enter a valid email");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email");
  });

  it("does not treat an empty error as invalid", () => {
    render(
      <FormField label="Name" error="">
        <Input />
      </FormField>,
    );

    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("passes wiring props to a render function and keeps a custom id", () => {
    render(
      <FormField id="table-number" label="Table" error="Required" required>
        {(controlProps) => <input {...controlProps} data-testid="custom" />}
      </FormField>,
    );

    const control = screen.getByTestId("custom");
    expect(control).toHaveAttribute("id", "table-number");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-required", "true");
    expect(control).toHaveAttribute("aria-describedby", "table-number-error");
    expect(screen.getByLabelText(/Table/)).toBe(control);
  });

  it("keeps props already set on the child element", () => {
    render(
      <FormField label="Notes">
        <Input name="notes" placeholder="No onions" />
      </FormField>,
    );

    const input = screen.getByLabelText("Notes");
    expect(input).toHaveAttribute("name", "notes");
    expect(input).toHaveAttribute("placeholder", "No onions");
  });
});
