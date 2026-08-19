import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Movie } from "../api";
import { LibraryPage } from "./library-page";

const movies: Movie[] = [
  {
    added_at: "2026-08-08T00:00:00.000Z",
    collection_id: "collection-id",
    collection_name: "Test Saga",
    collection_position: 2,
    id: "second-id",
    imdb_id: null,
    poster_path: null,
    rating_phrase: null,
    rating_score: null,
    release_date: "2022-01-01",
    runtime_minutes: null,
    version: null,
    version_runtime: null,
    version_reference_url: null,
    title: "Zulu Movie",
    tmdb_id: null,
    watched_at: null,
  },
  {
    added_at: "2026-08-07T00:00:00.000Z",
    collection_id: null,
    id: "first-id",
    imdb_id: "tt0133093",
    poster_path: null,
    rating_phrase: "A favorite",
    rating_score: 5,
    release_date: "2020-01-01",
    runtime_minutes: null,
    version: null,
    version_runtime: null,
    version_reference_url: null,
    title: "Alpha Movie",
    tmdb_id: 603,
    watched_at: "2026-08-07T00:00:00.000Z",
  },
];

function getRenderedMovieTitles() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent);
}

describe("movie library", () => {
  it("appends a specified version to the displayed title", () => {
    render(
      <LibraryPage
        canMutate={false}
        movies={[{ ...movies[1], title: "Batman", version: "Director's Cut" }]}
        onEdit={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Batman (Director's Cut)" }),
    ).toBeVisible();
  });

  it("filters, sorts, and exposes actions only to contributors", async () => {
    const onEdit = vi.fn();
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <LibraryPage
        canMutate
        movies={movies}
        onEdit={onEdit}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText("1 unwatched out of 2 movies")).toBeVisible();
    await user.type(
      screen.getByRole("textbox", { name: "Search movie library" }),
      "Zulu",
    );
    expect(screen.getByText("1 of 2 movies")).toBeVisible();
    expect(screen.getByText("Zulu Movie")).toBeVisible();
    expect(screen.queryByText("Alpha Movie")).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: "Collection" }),
    ).toBeVisible();
    expect(
      screen.getByRole("columnheader", { name: "Date Added" }),
    ).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Links" })).toBeVisible();

    await user.clear(
      screen.getByRole("textbox", { name: "Search movie library" }),
    );
    await user.click(screen.getByRole("button", { name: "Title" }));
    expect(screen.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(getRenderedMovieTitles()).toEqual(["Alpha Movie", "Zulu Movie"]);
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(onEdit).toHaveBeenCalledWith(movies[1]);
    await user.click(screen.getByRole("button", { name: /Title/ }));
    expect(screen.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(getRenderedMovieTitles()).toEqual(["Zulu Movie", "Alpha Movie"]);
    expect(screen.getByText("5 · A favorite")).toBeVisible();
    expect(screen.getByText("Aug 7, 2026")).toBeVisible();
    expect(screen.getByText("Aug 8, 2026")).toBeVisible();
    expect(screen.queryByText("Standalone")).toBeNull();
    expect(screen.queryByText("In rotation")).toBeNull();
    expect(screen.queryByText("5/5")).toBeNull();
    const movieLink = screen.getByRole("link", { name: "Alpha Movie" });
    expect(movieLink).toHaveAttribute("href", "/movies/first-id?from=library");
    await user.click(movieLink);
    expect(onNavigate).toHaveBeenCalledWith("/movies/first-id?from=library");
    const collectionLink = screen.getByRole("link", { name: "Test Saga" });
    expect(collectionLink).toHaveAttribute(
      "href",
      "/collections/collection-id",
    );
    const tmdbLink = screen.getByRole("link", { name: "TMDB" });
    expect(tmdbLink).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/movie/603",
    );
    expect(tmdbLink).toHaveAttribute("target", "_blank");
    expect(screen.getAllByRole("link", { name: "TMDB" })).toHaveLength(1);
    const imdbLink = screen.getByRole("link", { name: "IMDb" });
    expect(imdbLink).toHaveAttribute(
      "href",
      "https://www.imdb.com/title/tt0133093/",
    );
    expect(imdbLink).toHaveAttribute("target", "_blank");
    expect(within(imdbLink.closest("td")!).getByText("·")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Date Added" }));
    expect(
      screen.getByRole("columnheader", { name: /Date Added/ }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(getRenderedMovieTitles()).toEqual(["Alpha Movie", "Zulu Movie"]);
  });

  it("uses ratings as the only indication that a movie was watched", () => {
    render(
      <LibraryPage
        canMutate
        movies={movies}
        onEdit={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Rating" })).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();
    expect(screen.getByText("5 · A favorite")).toBeVisible();
    expect(screen.queryByText("Watched")).toBeNull();
    expect(screen.queryByText("Unwatched")).toBeNull();
  });

  it("keeps zero-rated movies ahead of unrated movies when sorting", async () => {
    const user = userEvent.setup();
    const zeroRatedMovie: Movie = {
      ...movies[1],
      id: "zero-id",
      rating_phrase: "Zero elements",
      rating_score: 0,
      title: "Zero Movie",
    };

    render(
      <LibraryPage
        canMutate={false}
        movies={[movies[0], movies[1], zeroRatedMovie]}
        onEdit={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rating" }));
    expect(
      screen.getByRole("columnheader", { name: /Rating/ }),
    ).toHaveAttribute("aria-sort", "descending");
    expect(getRenderedMovieTitles()).toEqual([
      "Alpha Movie",
      "Zero Movie",
      "Zulu Movie",
    ]);

    await user.click(screen.getByRole("button", { name: /Rating/ }));
    expect(
      screen.getByRole("columnheader", { name: /Rating/ }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(getRenderedMovieTitles()).toEqual([
      "Zero Movie",
      "Alpha Movie",
      "Zulu Movie",
    ]);
  });

  it("keeps the public catalog browse-only", () => {
    render(
      <LibraryPage
        canMutate={false}
        movies={movies}
        onEdit={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Order" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.getByText("2 of 2 movies")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "Library" }),
    ).toBeVisible();
    expect(screen.getByText("Test Saga")).toBeVisible();
  });
});
