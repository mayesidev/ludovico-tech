import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  type LibraryQuery,
  type LibraryResponse,
  type Movie,
} from "../api";
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

const response = (
  pageMovies: Movie[] = movies,
  overrides: Partial<LibraryResponse> = {},
): LibraryResponse => ({
  counts: { total: 2, unwatched: 1 },
  movies: pageMovies,
  pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
  ...overrides,
});

const renderLibrary = (canMutate = true) =>
  render(
    <LibraryPage
      canMutate={canMutate}
      onEdit={vi.fn()}
      onNavigate={vi.fn()}
      reloadToken={0}
    />,
  );

afterEach(() => vi.restoreAllMocks());

describe("movie library", () => {
  it("renders the bounded server page with catalog-wide totals and links", async () => {
    vi.spyOn(api, "library").mockResolvedValue(
      response([{ ...movies[1], title: "Batman", version: "Director's Cut" }]),
    );
    renderLibrary(false);

    expect(
      await screen.findByRole("link", { name: "Batman (Director's Cut)" }),
    ).toBeVisible();
    expect(screen.getByText("1 unwatched out of 2 movies")).toBeVisible();
    expect(screen.getByText("1–2 of 2 movies")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("link", { name: "TMDB" })).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/movie/603",
    );
    expect(screen.getByRole("link", { name: "IMDb" })).toHaveAttribute(
      "href",
      "https://www.imdb.com/title/tt0133093/",
    );
  });

  it("debounces whole-library search and requests server sorting", async () => {
    const load = vi
      .spyOn(api, "library")
      .mockImplementation(async (query: LibraryQuery) => {
        if (query.search === "Zulu") return response([movies[0]]);
        if (query.sort === "title" && query.direction === "desc") {
          return response(movies);
        }
        return response([...movies].reverse());
      });
    const user = userEvent.setup();
    renderLibrary();
    await screen.findByText("Alpha Movie");

    await user.type(
      screen.getByRole("textbox", { name: "Search movie library" }),
      "Zulu",
    );
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, search: "Zulu" }),
      ),
    );
    expect(await screen.findByText("Zulu Movie")).toBeVisible();
    expect(screen.queryByText("Alpha Movie")).toBeNull();

    await user.clear(
      screen.getByRole("textbox", { name: "Search movie library" }),
    );
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: /Title/ }));
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(
        expect.objectContaining({ direction: "desc", sort: "title" }),
      ),
    );
    expect(screen.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("navigates pages and changes the server page size", async () => {
    const load = vi
      .spyOn(api, "library")
      .mockImplementation(async (query: LibraryQuery) =>
        response(query.page === 2 ? [movies[0]] : [movies[1]], {
          counts: { total: 51, unwatched: 25 },
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            total: 51,
            totalPages: Math.ceil(51 / query.pageSize),
          },
        }),
      );
    const user = userEvent.setup();
    renderLibrary(false);

    expect(await screen.findByText("Page 1 of 2")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next Library page" }));
    expect(await screen.findByText("Page 2 of 2")).toBeVisible();
    expect(screen.getByText("51–51 of 51 movies")).toBeVisible();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Library rows per page" }),
      "25",
    );
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, pageSize: 25 }),
      ),
    );
  });

  it("keeps zero ratings visible and sends edits for the selected row", async () => {
    const zeroRatedMovie = {
      ...movies[1],
      id: "zero-id",
      rating_phrase: "Zero elements",
      rating_score: 0,
      title: "Zero Movie",
    };
    vi.spyOn(api, "library").mockResolvedValue(response([zeroRatedMovie]));
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(
      <LibraryPage
        canMutate
        onEdit={onEdit}
        onNavigate={vi.fn()}
        reloadToken={0}
      />,
    );

    expect(await screen.findByText("0 · Zero elements")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(zeroRatedMovie);
  });

  it("keeps the public catalog browse-only", async () => {
    vi.spyOn(api, "library").mockResolvedValue(response());
    renderLibrary(false);

    const table = await screen.findByRole("table");
    expect(within(table).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(
      within(table).queryByRole("columnheader", { name: "Actions" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Library" }),
    ).toBeVisible();
    expect(screen.getByText("Test Saga")).toBeVisible();
  });
});
