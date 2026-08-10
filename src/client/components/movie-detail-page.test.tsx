import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Movie } from "../api";
import { MovieDetailPage } from "./movie-detail-page";

const movie: Movie = {
  added_at: "2026-08-07T00:00:00.000Z",
  franchise_id: "franchise-id",
  franchise_name: "Test Saga",
  franchise_position: 1,
  id: "movie-id",
  poster_path: null,
  rating_phrase: "There is no spoon",
  rating_score: 5,
  release_date: "1999-03-31",
  title: "Test Movie",
  tmdb_id: 603,
  watched_at: "2026-08-07T00:00:00.000Z",
};

describe("movie details", () => {
  it("shows confirmed catalog, rating, and TMDB details", () => {
    render(<MovieDetailPage movie={movie} onNavigate={vi.fn()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Test Movie" }),
    ).toBeVisible();
    expect(screen.getByText("Watched")).toBeVisible();
    expect(screen.getByText("Mar 31, 1999")).toBeVisible();
    expect(screen.getByText("Release date")).toBeVisible();
    expect(screen.getByText("Date added")).toBeVisible();
    expect(screen.getByText("Aug 7, 2026")).toBeVisible();
    expect(screen.getByText("5")).toBeVisible();
    expect(screen.getByText("“There is no spoon”")).toBeVisible();
    expect(screen.getByRole("link", { name: "Test Saga" })).toHaveAttribute(
      "href",
      "/franchises/franchise-id",
    );
    expect(screen.getByRole("link", { name: "View on TMDB" })).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/movie/603",
    );
  });

  it("does not invent a TMDB link for an unconfirmed movie", () => {
    render(
      <MovieDetailPage
        movie={{
          ...movie,
          franchise_id: null,
          franchise_name: null,
          added_at: "",
          rating_phrase: null,
          rating_score: null,
          release_date: null,
          tmdb_id: null,
          watched_at: null,
        }}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("Unwatched")).toBeVisible();
    expect(screen.queryByRole("link", { name: "View on TMDB" })).toBeNull();
    expect(screen.queryByText("Test Saga")).toBeNull();
    expect(screen.queryByText("Release date")).toBeNull();
    expect(screen.getByText("Unknown date")).toBeVisible();
  });

  it("offers a way back when the movie does not exist", () => {
    render(<MovieDetailPage movie={null} onNavigate={vi.fn()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Movie not found" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to the library" }),
    ).toHaveAttribute("href", "/library");
  });
});
