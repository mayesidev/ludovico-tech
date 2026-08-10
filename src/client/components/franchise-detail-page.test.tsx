import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, type Movie } from "../api";
import type { RunAction } from "../types";
import { FranchiseDetailPage } from "./franchise-detail-page";

const movie = (overrides: Partial<Movie>): Movie => ({
  added_at: "2026-08-07T00:00:00.000Z",
  franchise_id: "franchise-id",
  franchise_name: "Test Saga",
  franchise_position: 1,
  id: "first-id",
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: null,
  runtime_minutes: null,
  title: "First Movie",
  tmdb_id: null,
  watched_at: null,
  ...overrides,
});

const movies = [
  movie({
    franchise_position: 2,
    id: "second-id",
    rating_phrase: "A sequel phrase",
    rating_score: 4,
    title: "Second Movie",
    watched_at: "2026-08-07T00:00:00.000Z",
  }),
  movie({}),
  movie({ franchise_id: null, franchise_name: null, id: "outside-id" }),
];

const run: RunAction = async (action, after) => {
  await action();
  after?.();
};

describe("franchise details", () => {
  it("lists every member in saved order and persists a complete reorder", async () => {
    vi.spyOn(api, "order").mockResolvedValue({ nowShowing: {} as never });
    const user = userEvent.setup();
    render(
      <FranchiseDetailPage
        busy={false}
        canMutate
        franchiseId="franchise-id"
        movies={movies}
        onLogin={vi.fn()}
        onNavigate={vi.fn()}
        returnTo="library"
        run={run}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Test Saga" }),
    ).toBeVisible();
    expect(screen.getByText("2 movies")).toBeVisible();
    const links = screen.getAllByRole("link").map((link) => link.textContent);
    expect(links).toEqual(["Library", "First Movie", "Second Movie"]);
    expect(screen.getByText("Unwatched")).toBeVisible();
    expect(screen.getByText("Watched")).toBeVisible();
    expect(screen.getByText("4 · A sequel phrase")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Move Second Movie up" }),
    );
    await user.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() =>
      expect(api.order).toHaveBeenCalledWith("franchise-id", [
        "second-id",
        "first-id",
      ]),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Order saved.");
  });

  it("keeps ordering read-only for anonymous visitors", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(
      <FranchiseDetailPage
        busy={false}
        canMutate={false}
        franchiseId="franchise-id"
        movies={movies}
        onLogin={onLogin}
        onNavigate={vi.fn()}
        returnTo="library"
        run={run}
      />,
    );

    expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save order" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Sign in to set the order" }),
    );
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it("renders a useful not-found state", () => {
    render(
      <FranchiseDetailPage
        busy={false}
        canMutate={false}
        franchiseId="missing-id"
        movies={movies}
        onLogin={vi.fn()}
        onNavigate={vi.fn()}
        returnTo="library"
        run={run}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Franchise not found" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to the library" }),
    ).toHaveAttribute("href", "/library");
  });

  it("returns an order confirmation to Now showing after saving", async () => {
    vi.spyOn(api, "order").mockResolvedValue({ nowShowing: {} as never });
    const user = userEvent.setup();
    render(
      <FranchiseDetailPage
        busy={false}
        canMutate
        franchiseId="franchise-id"
        movies={movies}
        onLogin={vi.fn()}
        onNavigate={vi.fn()}
        returnTo="now-showing"
        run={run}
      />,
    );

    const returnLink = screen.getByRole("link", {
      name: "Return to Now Showing",
    });
    expect(returnLink).toHaveAttribute("href", "/");
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Order saved.");
    expect(returnLink).toHaveAttribute("href", "/");
  });
});
