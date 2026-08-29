import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MovieDetail } from "../api";
import { MovieDetailPage } from "./movie-detail-page";

const movie: MovieDetail = {
  added_at: "2026-08-07T00:00:00.000Z",
  cast: [],
  collection_id: "collection-id",
  collection_name: "Test Saga",
  collection_position: 1,
  directors: [],
  id: "movie-id",
  imdb_id: "tt0133093",
  poster_path: null,
  rating_phrase: "There is no spoon",
  rating_score: 5,
  release_date: "1999-03-31",
  runtime_minutes: 136,
  version: null,
  version_runtime: null,
  version_reference_url: null,
  title: "Test Movie",
  tmdb_collection_id: 2344,
  tmdb_collection_name: "Test Movie Collection",
  tmdb_id: 603,
  watched_at: "2026-08-07T00:00:00.000Z",
};

describe("movie details", () => {
  it("shows collapsed attribution only to an authenticated user", async () => {
    const attributedMovie: MovieDetail = {
      ...movie,
      audit: {
        added: { at: "2026-08-07T12:00:00.000Z", by: "Adding User" },
        metadata: {
          at: "2026-08-08T13:00:00.000Z",
          by: "TMDB refresh automation",
        },
        rating: { at: "2026-08-09T14:00:00.000Z", by: "Rating User" },
        updated: { at: "2026-08-10T15:00:00.000Z", by: "Editing User" },
      },
    };
    const { rerender } = render(
      <MovieDetailPage
        canMutate
        movie={attributedMovie}
        onEdit={vi.fn()}
        onNavigate={vi.fn()}
        returnTo="library"
      />,
    );
    const activity = screen.getByRole("region", {
      name: "Activity attribution",
    });
    const history = screen.getByText("History", { selector: "summary" });
    expect(
      screen
        .getByRole("link", { name: /View on IMDb/ })
        .compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      history.compareDocumentPosition(
        screen.getByRole("button", { name: "Edit Movie" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(activity).not.toBeVisible();
    await userEvent.click(history);
    expect(within(activity).getByText(/Adding User/)).toBeVisible();
    expect(within(activity).getByText(/Rating User/)).toBeVisible();
    expect(within(activity).getByText(/TMDB refresh automation/)).toBeVisible();

    rerender(
      <MovieDetailPage
        movie={attributedMovie}
        onNavigate={vi.fn()}
        returnTo="library"
      />,
    );
    expect(
      screen.queryByRole("region", { name: "Activity attribution" }),
    ).toBeNull();
  });

  it("shows the persisted top cast and directors", () => {
    render(
      <MovieDetailPage
        movie={{
          ...movie,
          cast: [
            { tmdbId: 1, name: "First Actor" },
            { tmdbId: 2, name: "Second Actor" },
            { tmdbId: 3, name: "Third Actor" },
            { tmdbId: 4, name: "Fourth Actor" },
            { tmdbId: 5, name: "Fifth Actor" },
          ],
          directors: [
            { tmdbId: 21, name: "First Director" },
            { tmdbId: 22, name: "Second Director" },
            { tmdbId: 23, name: "Third Director" },
          ],
        }}
        onNavigate={vi.fn()}
        returnTo="library"
      />,
    );

    expect(screen.getByText("Directed by")).toBeVisible();
    expect(
      screen.getByText("First Director, Second Director, Third Director"),
    ).toBeVisible();
    expect(screen.getByText("Starring")).toBeVisible();
    expect(
      screen.getByText(
        "First Actor, Second Actor, Third Actor, Fourth Actor, Fifth Actor",
      ),
    ).toBeVisible();
  });

  it("omits empty cast and director fields", () => {
    render(
      <MovieDetailPage movie={movie} onNavigate={vi.fn()} returnTo="library" />,
    );

    expect(screen.queryByText("Directed by")).toBeNull();
    expect(screen.queryByText("Starring")).toBeNull();
  });

  it("appends the version to the title and uses its runtime override", () => {
    render(
      <MovieDetailPage
        movie={{
          ...movie,
          title: "Batman",
          version: "Director's Cut",
          version_reference_url: "https://example.com/batman-directors-cut",
          version_runtime: 132,
        }}
        onNavigate={vi.fn()}
        returnTo="library"
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Batman (Director's Cut)",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Director's Cut/ }),
    ).toHaveAttribute("href", "https://example.com/batman-directors-cut");
    expect(screen.getByText("2h 12m")).toBeVisible();
    expect(screen.queryByText("2h 16m")).toBeNull();
  });

  it("falls back to the TMDB runtime when a version has no override", () => {
    render(
      <MovieDetailPage
        movie={{ ...movie, version: "International Release" }}
        onNavigate={vi.fn()}
        returnTo="library"
      />,
    );

    expect(screen.getByText("2h 16m")).toBeVisible();
  });

  it("gives the title the header width not needed by the rating", () => {
    render(
      <MovieDetailPage movie={movie} onNavigate={vi.fn()} returnTo="library" />,
    );

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Test Movie",
    });
    const rating = screen.getByLabelText("Rating: 5 There is no spoon");
    expect(heading).toBeVisible();
    expect(rating).toBeVisible();
    expect(rating.parentElement).toBe(heading.parentElement);
    expect(rating.parentElement).toHaveClass(
      "sm:grid-cols-[minmax(0,1fr)_auto]",
    );
    expect(rating).toHaveClass("sm:max-w-64", "sm:justify-self-end");
    expect(screen.queryByText("Watched")).toBeNull();
    expect(screen.queryByText("Unwatched")).toBeNull();
    expect(screen.getByText("Mar 31, 1999")).toBeVisible();
    expect(screen.getByText("Release date")).toBeVisible();
    expect(screen.getByText("Date added")).toBeVisible();
    expect(screen.getByText("Runtime")).toBeVisible();
    expect(screen.getByText("Collection")).toBeVisible();
    expect(screen.getByText("TMDB collection")).toBeVisible();
    expect(screen.getByText("2h 16m")).toBeVisible();
    expect(screen.getByText("Aug 7, 2026")).toBeVisible();
    expect(screen.getByText("5")).toBeVisible();
    expect(screen.getByText("There is no spoon")).toBeVisible();
    expect(screen.getByRole("link", { name: "Test Saga" })).toHaveAttribute(
      "href",
      "/collections/collection-id",
    );
    expect(
      screen.getByRole("link", { name: "Return to Library" }),
    ).toHaveAttribute("href", "/library");
    expect(screen.getByRole("link", { name: "View on TMDB" })).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/movie/603",
    );
    expect(screen.getByRole("link", { name: "View on IMDb" })).toHaveAttribute(
      "href",
      "https://www.imdb.com/title/tt0133093/",
    );
    expect(
      screen.getByRole("link", { name: "Test Movie Collection" }),
    ).toHaveAttribute("href", "https://www.themoviedb.org/collection/2344");
  });

  it("offers editing to authenticated contributors", async () => {
    const onEdit = vi.fn();
    render(
      <MovieDetailPage
        canMutate
        movie={movie}
        onEdit={onEdit}
        onNavigate={vi.fn()}
        returnTo="library"
      />,
    );

    const editButton = screen.getByRole("button", { name: "Edit Movie" });
    const providerLinks = screen.getByRole("link", {
      name: "View on TMDB",
    }).parentElement;
    const actions = editButton.parentElement;
    expect(actions).not.toBe(providerLinks);
    expect(actions?.parentElement?.previousElementSibling).toBe(providerLinks);

    editButton.click();
    expect(onEdit).toHaveBeenCalledWith(movie);
    expect(screen.queryByRole("button", { name: "Delete Movie" })).toBeNull();
  });

  it("offers deletion only for an authenticated unwatched movie", () => {
    const onDelete = vi.fn();
    const unwatched = {
      ...movie,
      rating_phrase: null,
      rating_score: null,
      watched_at: null,
    };
    const { rerender } = render(
      <MovieDetailPage
        canMutate
        movie={unwatched}
        onDelete={onDelete}
        onNavigate={vi.fn()}
        returnTo="library"
      />,
    );

    screen.getByRole("button", { name: "Delete Movie" }).click();
    expect(onDelete).toHaveBeenCalledWith(unwatched);
    const collectionLink = screen.getByRole("link", { name: "Test Saga" });
    expect(collectionLink.closest("dl")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "View on TMDB" }).closest("dl"),
    ).toBeNull();

    rerender(
      <MovieDetailPage
        movie={unwatched}
        onDelete={onDelete}
        onNavigate={vi.fn()}
        returnTo="library"
      />,
    );
    expect(screen.queryByRole("button", { name: "Delete Movie" })).toBeNull();
  });

  it("does not invent a TMDB link for an unconfirmed movie", () => {
    render(
      <MovieDetailPage
        movie={{
          ...movie,
          collection_id: null,
          collection_name: null,
          added_at: "",
          rating_phrase: null,
          rating_score: null,
          release_date: null,
          runtime_minutes: null,
          version: null,
          version_runtime: null,
          version_reference_url: null,
          imdb_id: null,
          tmdb_collection_id: null,
          tmdb_collection_name: null,
          tmdb_id: null,
          watched_at: null,
        }}
        onNavigate={vi.fn()}
        returnTo="library"
      />,
    );

    expect(screen.queryByText("Watched")).toBeNull();
    expect(screen.queryByText("Unwatched")).toBeNull();
    expect(screen.queryByLabelText(/^Rating:/)).toBeNull();
    expect(screen.queryByRole("link", { name: "View on TMDB" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View on IMDb" })).toBeNull();
    expect(screen.queryByText("Test Saga")).toBeNull();
    expect(screen.queryByText("Release date")).toBeNull();
    expect(screen.queryByText("Runtime")).toBeNull();
    expect(screen.queryByText("TMDB collection")).toBeNull();
    expect(screen.getByText("Unknown date")).toBeVisible();
  });

  it("offers a way back when the movie does not exist", () => {
    render(
      <MovieDetailPage movie={null} onNavigate={vi.fn()} returnTo="library" />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Movie Not Found" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to Library" }),
    ).toHaveAttribute("href", "/library");
  });

  it("returns home when opened from Now Showing", () => {
    render(
      <MovieDetailPage
        movie={movie}
        onNavigate={vi.fn()}
        returnTo="now-showing"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Return to Now Showing" }),
    ).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Test Saga" })).toHaveAttribute(
      "href",
      "/collections/collection-id?from=now-showing",
    );
    expect(
      screen.queryByRole("link", { name: "Return to Library" }),
    ).toBeNull();
  });

  it("returns to the Manager's Office when opened from refresh status", () => {
    render(
      <MovieDetailPage
        movie={movie}
        onNavigate={vi.fn()}
        returnTo="manager-office"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Return to Manager's Office" }),
    ).toHaveAttribute("href", "/manager-office");
    expect(screen.getByRole("link", { name: "Test Saga" })).toHaveAttribute(
      "href",
      "/collections/collection-id?from=manager-office",
    );
  });
});
