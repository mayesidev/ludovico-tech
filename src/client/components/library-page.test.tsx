import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Movie } from "../api";
import { LibraryPage } from "./library-page";

const movies: Movie[] = [
  {
    added_at: "2026-08-07T00:00:00.000Z",
    franchise_id: "franchise-id",
    franchise_name: "Test Saga",
    franchise_position: 2,
    id: "second-id",
    poster_path: null,
    rating_phrase: null,
    rating_score: null,
    release_date: "2022-01-01",
    title: "Zulu Movie",
    tmdb_id: null,
    watched_at: null,
  },
  {
    added_at: "2026-08-07T00:00:00.000Z",
    franchise_id: null,
    id: "first-id",
    poster_path: null,
    rating_phrase: "A favorite",
    rating_score: 5,
    release_date: "2020-01-01",
    title: "Alpha Movie",
    tmdb_id: null,
    watched_at: "2026-08-07T00:00:00.000Z",
  },
];

describe("movie library", () => {
  it("filters, sorts, and exposes actions only to contributors", async () => {
    const onEdit = vi.fn();
    const onOrder = vi.fn();
    const user = userEvent.setup();
    render(
      <LibraryPage
        canMutate
        movies={movies}
        onEdit={onEdit}
        onOrder={onOrder}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Search movie library" }),
      "Zulu",
    );
    expect(screen.getByText("1 of 2 movies")).toBeVisible();
    expect(screen.getByText("Zulu Movie")).toBeVisible();
    expect(screen.queryByText("Alpha Movie")).toBeNull();

    await user.clear(
      screen.getByRole("textbox", { name: "Search movie library" }),
    );
    await user.click(screen.getByRole("button", { name: "Title" }));
    expect(screen.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await user.click(screen.getByRole("button", { name: "Order" }));
    expect(onEdit).toHaveBeenCalledWith(movies[1]);
    expect(onOrder).toHaveBeenCalledWith("franchise-id");
  });

  it("keeps the public catalog browse-only", () => {
    render(
      <LibraryPage
        canMutate={false}
        movies={movies}
        onEdit={vi.fn()}
        onOrder={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Order" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.getByText("2 of 2 movies")).toBeVisible();
  });
});
