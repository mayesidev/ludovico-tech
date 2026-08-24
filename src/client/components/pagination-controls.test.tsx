import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { PaginationControls } from "./pagination-controls";

const renderControls = (
  overrides: Partial<ComponentProps<typeof PaginationControls>> = {},
) => {
  const props: ComponentProps<typeof PaginationControls> = {
    context: "Test catalog",
    itemLabel: "titles",
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    page: 1,
    pageSize: 25,
    refreshing: false,
    total: 100,
    totalPages: 4,
    ...overrides,
  };
  return { ...render(<PaginationControls {...props} />), props };
};

describe("pagination controls", () => {
  it("offers every page and supports direct, previous, and next navigation", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderControls();
    const pageSelector = screen.getByRole("combobox", {
      name: "Test catalog page",
    });

    expect(within(pageSelector).getAllByRole("option")).toHaveLength(4);
    await user.selectOptions(pageSelector, "3");
    expect(props.onPageChange).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(props.onPageChange).toHaveBeenCalledWith(2);

    rerender(<PaginationControls {...props} page={4} />);
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Previous/ }));
    expect(props.onPageChange).toHaveBeenCalledWith(3);
  });

  it("disables navigation for one page and while refreshing", () => {
    const { props, rerender } = renderControls({ total: 1, totalPages: 1 });

    expect(screen.getByRole("combobox", { name: "Test catalog page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();

    rerender(
      <PaginationControls
        {...props}
        page={2}
        refreshing
        total={100}
        totalPages={4}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Test catalog page" })).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Test catalog rows per page" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  });

  it("reflects a server-clamped page and reduced page options", () => {
    const { props, rerender } = renderControls({ page: 4 });

    rerender(
      <PaginationControls {...props} page={2} total={40} totalPages={2} />,
    );
    expect(screen.getByRole("combobox", { name: "Test catalog page" })).toHaveValue("2");
    expect(
      screen.getByRole("combobox", { name: "Test catalog page" }).children,
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  });
});
