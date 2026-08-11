import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Movie } from "../api";
import { MovieDetailPage } from "./movie-detail-page";

const movie: Movie = {
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: "collection-id",
  collection_name: "Test Saga",
  collection_position: 1,
  id: "movie-id",
  poster_path: null,
  rating_phrase: "There is no spoon",
  rating_score: 5,
  release_date: "1999-03-31",
  runtime_minutes: 136,
  title: "Test Movie",
  tmdb_collection_id: 2344,
  tmdb_collection_name: "Test Movie Collection",
  tmdb_id: 603,
  watched_at: "2026-08-07T00:00:00.000Z",
};

describe("movie details", () => {
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

    screen.getByRole("button", { name: "Edit movie" }).click();
    expect(onEdit).toHaveBeenCalledWith(movie);
    expect(screen.queryByRole("button", { name: "Delete movie" })).toBeNull();
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

    screen.getByRole("button", { name: "Delete movie" }).click();
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
    expect(screen.queryByRole("button", { name: "Delete movie" })).toBeNull();
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
      screen.getByRole("heading", { level: 1, name: "Movie not found" }),
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
});
