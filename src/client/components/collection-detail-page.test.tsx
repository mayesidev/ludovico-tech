import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, type Movie } from "../api";
import type { RunAction } from "../types";
import { CollectionDetailPage } from "./collection-detail-page";

const movie = (overrides: Partial<Movie>): Movie => ({
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: "collection-id",
  collection_name: "Test Saga",
  collection_order_confirmed: 1,
  collection_position: 1,
  id: "first-id",
  imdb_id: null,
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: null,
  runtime_minutes: null,
  version: null,
  version_runtime: null,
  version_reference_url: null,
  title: "First Movie",
  tmdb_id: null,
  watched_at: null,
  ...overrides,
});

const movies = [
  movie({
    collection_position: 2,
    id: "second-id",
    rating_phrase: "A sequel phrase",
    rating_score: 4,
    title: "Second Movie",
    watched_at: "2026-08-07T00:00:00.000Z",
  }),
  movie({}),
  movie({ collection_id: null, collection_name: null, id: "outside-id" }),
];

const run: RunAction = async (action, after) => {
  await action();
  after?.();
};

describe("collection details", () => {
  it("shows collapsed collection attribution only to an authenticated user", async () => {
    const audit = {
      created: { at: "2026-08-07T12:00:00.000Z", by: "Creating User" },
      updated: { at: "2026-08-08T12:00:00.000Z", by: "Updating User" },
    };
    const { rerender } = render(
      <CollectionDetailPage
        audit={audit}
        busy={false}
        canMutate
        collectionId="collection-id"
        movies={movies}
        onLogin={vi.fn()}
        onNavigate={vi.fn()}
        returnTo="library"
        run={run}
      />,
    );
    expect(screen.getByText(/Creating User/)).not.toBeVisible();
    await userEvent.click(screen.getByText("History", { selector: "summary" }));
    expect(screen.getByText(/Creating User/)).toBeVisible();
    expect(screen.getByText(/Updating User/)).toBeVisible();

    rerender(
      <CollectionDetailPage
        audit={audit}
        busy={false}
        canMutate={false}
        collectionId="collection-id"
        movies={movies}
        onLogin={vi.fn()}
        onNavigate={vi.fn()}
        returnTo="library"
        run={run}
      />,
    );
    expect(screen.queryByText(/Creating User/)).toBeNull();
  });

  it("uses date added before a custom order is saved", () => {
    render(
      <CollectionDetailPage
        busy={false}
        canMutate
        collectionId="collection-id"
        movies={[
          movie({
            added_at: "2026-08-02T00:00:00.000Z",
            collection_order_confirmed: 0,
            collection_position: 1,
            id: "later-id",
            title: "Added Later",
          }),
          movie({
            added_at: "2026-08-01T00:00:00.000Z",
            collection_order_confirmed: 0,
            collection_position: 2,
            id: "earlier-id",
            title: "Added Earlier",
          }),
        ]}
        onLogin={vi.fn()}
        onNavigate={vi.fn()}
        returnTo="library"
        run={run}
      />,
    );

    const links = screen.getAllByRole("link").map((link) => link.textContent);
    expect(links).toEqual(["Library", "Added Earlier", "Added Later"]);
    expect(
      screen.getByText("Using date added until you save a custom order."),
    ).toBeVisible();
  });

  it("lists every member in saved order and persists a complete reorder", async () => {
    vi.spyOn(api, "order").mockResolvedValue({ nowShowing: {} as never });
    const user = userEvent.setup();
    render(
      <CollectionDetailPage
        busy={false}
        canMutate
        collectionId="collection-id"
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
    expect(
      screen.getByRole("heading", { level: 2, name: "Collection Order" }),
    ).toBeVisible();
    expect(screen.queryByText("Using the saved collection order.")).toBeNull();
    expect(screen.queryByText(/Related TMDB Collection/)).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Move Second Movie Up" }),
    );
    await user.click(screen.getByRole("button", { name: "Save Order" }));

    await waitFor(() =>
      expect(api.order).toHaveBeenCalledWith("collection-id", [
        "second-id",
        "first-id",
      ]),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Order saved.");
  });

  it("links every distinct related TMDB collection without changing the local grouping", () => {
    render(
      <CollectionDetailPage
        busy={false}
        canMutate={false}
        collectionId="collection-id"
        movies={[
          movie({
            tmdb_collection_id: 7,
            tmdb_collection_name: "First Official Collection",
          }),
          movie({
            collection_position: 2,
            id: "second-id",
            tmdb_collection_id: 8,
            tmdb_collection_name: "Second Official Collection",
          }),
        ]}
        onLogin={vi.fn()}
        onNavigate={vi.fn()}
        returnTo="library"
        run={run}
      />,
    );

    expect(screen.getByText("Related TMDB Collections")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "First Official Collection" }),
    ).toHaveAttribute("href", "https://www.themoviedb.org/collection/7");
    expect(
      screen.getByRole("link", { name: "Second Official Collection" }),
    ).toHaveAttribute("href", "https://www.themoviedb.org/collection/8");
    expect(
      screen.getByRole("heading", { level: 1, name: "Test Saga" }),
    ).toBeVisible();
  });

  it("keeps ordering read-only for anonymous visitors", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(
      <CollectionDetailPage
        busy={false}
        canMutate={false}
        collectionId="collection-id"
        movies={movies}
        onLogin={onLogin}
        onNavigate={vi.fn()}
        returnTo="library"
        run={run}
      />,
    );

    expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save Order" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Sign In to Set the Order" }),
    );
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it("renders a useful not-found state", () => {
    render(
      <CollectionDetailPage
        busy={false}
        canMutate={false}
        collectionId="missing-id"
        movies={movies}
        onLogin={vi.fn()}
        onNavigate={vi.fn()}
        returnTo="library"
        run={run}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Collection Not Found" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to the Library" }),
    ).toHaveAttribute("href", "/library");
  });

  it("returns an order confirmation to Now showing after saving", async () => {
    vi.spyOn(api, "order").mockResolvedValue({ nowShowing: {} as never });
    const user = userEvent.setup();
    render(
      <CollectionDetailPage
        busy={false}
        canMutate
        collectionId="collection-id"
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
    expect(screen.getByRole("link", { name: "First Movie" })).toHaveAttribute(
      "href",
      "/movies/first-id?from=now-showing",
    );
    await user.click(screen.getByRole("button", { name: "Save Order" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Order saved.");
    expect(returnLink).toHaveAttribute("href", "/");
  });
});
