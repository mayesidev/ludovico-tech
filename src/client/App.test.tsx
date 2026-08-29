import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  api,
  ApiError,
  type AuthState,
  type Movie,
  type NowShowing,
} from "./api";
import {
  POSTER_REEL_DURATION_MS,
  POSTER_REEL_LEAD_IN_MS,
  POSTER_REVEAL_DURATION_MS,
} from "./lib/poster-reel";

const movie: Movie = {
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: "collection-id",
  collection_name: "Test Saga",
  collection_position: 1,
  id: "movie-id",
  imdb_id: null,
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: null,
  runtime_minutes: null,
  version: null,
  version_runtime: null,
  version_reference_url: null,
  title: "Test Movie",
  tmdb_id: null,
  watched_at: null,
};

const anonymous: AuthState = {
  user: null,
  authenticated: false,
  local: false,
};

const authenticated: AuthState = {
  user: { displayName: "Invited User", email: "invited@example.test" },
  authenticated: true,
  local: false,
};

const currentNowShowing: NowShowing = {
  cast: [],
  collection_id: null,
  collection_name: null,
  directors: [],
  id: 1,
  movie_id: "current-id",
  poster_path: "/current.jpg",
  rating_phrase: "Already watched",
  rating_score: 4,
  release_date: null,
  status: "watched",
  title: "Current Movie",
  version: null,
  watched_at: "2026-08-19T00:00:00.000Z",
};

const arrange = (auth: AuthState) => {
  vi.spyOn(api, "authMe").mockResolvedValue(auth);
  vi.spyOn(api, "movie").mockResolvedValue({
    movie: { ...movie, cast: [], directors: [] },
  });
  vi.spyOn(api, "library").mockResolvedValue({
    counts: { total: 1, unwatched: 1 },
    movies: [movie],
    pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
  });
  vi.spyOn(api, "home").mockResolvedValue({
    hasNextCollectionMovie: false,
    nowShowing: null,
    posterReelMovies: [movie],
    watchedMovies: [movie],
  });
  vi.spyOn(api, "collection").mockResolvedValue({
    collection: { id: "collection-id", name: "Test Saga" },
    movies: [movie],
    tmdbCollections: [],
  });
};

describe("application authorization presentation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lets anonymous visitors browse without rendering mutation controls", async () => {
    arrange(anonymous);
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "No Movie Selected",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Sign In$/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a Movie" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a Movie" })).toBeNull();
    expect(api.home).toHaveBeenCalledOnce();

    const library = screen.getByRole("link", { name: "Library" });
    await user.click(library);
    expect(window.location.pathname).toBe("/library");
    expect(library).toHaveAttribute("aria-current", "page");
    expect(api.library).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("link", { name: "Test Movie" }));
    expect(window.location.pathname).toBe("/movies/movie-id");
    expect(
      screen.getByRole("heading", { level: 1, name: "Test Movie" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Test Saga")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Order" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Return to Library" }),
    ).toHaveAttribute("href", "/library");

    await user.click(screen.getByRole("link", { name: "Ludovico Tech home" }));
    expect(screen.getByRole("link", { name: "Now Showing" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const credits = screen.getByRole("link", { name: "Credits" });
    await user.click(credits);
    expect(window.location.pathname).toBe("/credits");
    expect(
      screen.getByRole("heading", { level: 1, name: "Credits" }),
    ).toBeVisible();
    expect(credits).toHaveAttribute("aria-current", "page");
    expect(document.querySelector("footer")).toBeNull();
  });

  it("shows contributor controls to an authenticated visitor and logs out safely", async () => {
    arrange(authenticated);
    vi.spyOn(api, "logout").mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Choose a Movie" }),
    ).toBeVisible();
    const addMovie = screen.getByRole("button", { name: "Add a Movie" });
    expect(addMovie).toBeVisible();
    await user.click(addMovie);
    expect(screen.getByRole("dialog", { name: "Add a Movie" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close Add Movie" }));
    expect(addMovie).toHaveFocus();

    await user.click(screen.getByRole("link", { name: "Library" }));
    expect(window.location.pathname).toBe("/library");
    expect(screen.getByRole("button", { name: "Add a Movie" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Test Movie" }));
    await user.click(screen.getByRole("button", { name: "Edit Movie" }));
    expect(screen.getByRole("dialog", { name: "Edit Movie" })).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("link", { name: "Return to Library" }));
    await user.click(
      screen.getByRole("button", { name: "Sign Out Invited User" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Sign In$/ })).toBeVisible(),
    );
    expect(api.logout).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Choose a Movie" })).toBeNull();
  });

  it("keeps add-movie failures visible and dismissible above the open dialog", async () => {
    arrange(authenticated);
    vi.spyOn(api, "addMovie").mockRejectedValue(
      new ApiError("That TMDB movie is already in the catalog", 409),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Add a Movie" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add a Movie" });
    const title = within(dialog).getByRole("textbox", { name: "Movie title" });
    await user.type(title, "Existing TMDB Movie");
    await user.click(within(dialog).getByRole("button", { name: "Add Movie" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That TMDB movie is already in the catalog",
    );
    expect(alert).toHaveClass("fixed", "z-[60]");
    expect(alert.closest("[inert]")).toBeNull();
    expect(dialog).toBeVisible();
    expect(title).toHaveValue("Existing TMDB Movie");

    await user.click(screen.getByRole("button", { name: "Dismiss Error" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(dialog).toBeVisible();
    expect(title).toHaveValue("Existing TMDB Movie");
  });

  it("refreshes authentication and removes mutation controls after a 401", async () => {
    arrange(authenticated);
    vi.mocked(api.authMe)
      .mockResolvedValueOnce(authenticated)
      .mockResolvedValueOnce(anonymous);
    vi.spyOn(api, "roll").mockRejectedValue(
      new ApiError("Authentication required", 401),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Choose a Movie" }),
    );

    expect(
      await screen.findByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent("Your session ended. Sign in again to make changes.");
    expect(screen.getByRole("button", { name: /^Sign In$/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Choose a Movie" })).toBeNull();
    expect(api.authMe).toHaveBeenCalledTimes(2);
  });

  it("runs the poster reel before revealing the actual Now Showing movie", async () => {
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = vi.fn().mockResolvedValue(undefined);
      },
    );
    arrange(authenticated);
    vi.mocked(api.home).mockResolvedValue({
      hasNextCollectionMovie: false,
      nowShowing: currentNowShowing,
      posterReelMovies: [{ ...movie, poster_path: "/reel.jpg" }],
      watchedMovies: [movie],
    });
    vi.spyOn(api, "roll").mockResolvedValue({
      rolledMovie: { ...movie, id: "rolled-id", title: "Rolled Later Movie" },
      nowShowing: {
        cast: [],
        collection_id: "collection-id",
        collection_name: "Test Saga",
        directors: [],
        id: 1,
        movie_id: "actual-id",
        poster_path: "/actual.jpg",
        rating_phrase: null,
        rating_score: null,
        release_date: null,
        status: "ready",
        title: "Actual First Movie",
        version: null,
        watched_at: null,
      },
    });
    render(<App />);

    const choose = await screen.findByRole("button", {
      name: "Choose the Next Movie",
    });
    vi.useFakeTimers();
    fireEvent.click(choose);

    const openingReveal = screen.getByRole("status");
    expect(openingReveal).toHaveTextContent("Choosing a movie");
    expect(
      within(openingReveal).getByAltText("Poster for Current Movie"),
    ).toHaveAttribute("src", "https://image.tmdb.org/t/p/w500/current.jpg");
    await act(async () => {
      vi.advanceTimersByTime(POSTER_REEL_LEAD_IN_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByAltText("Poster for Test Movie")).toHaveAttribute(
      "src",
      "https://image.tmdb.org/t/p/w342/reel.jpg",
    );
    await act(async () => {
      vi.advanceTimersByTime(POSTER_REEL_DURATION_MS);
      await Promise.resolve();
    });
    const reveal = screen.getByRole("status");
    expect(reveal).toHaveTextContent("Now showing: Actual First Movie");
    expect(
      within(reveal).getByAltText("Poster for Actual First Movie"),
    ).toHaveAttribute("src", "https://image.tmdb.org/t/p/w342/actual.jpg");

    await act(async () => {
      vi.advanceTimersByTime(POSTER_REVEAL_DURATION_MS);
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("prepares one bounded reel when Strict Mode replays effects", async () => {
    const decode = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = decode;
      },
    );
    arrange(authenticated);
    vi.mocked(api.home).mockResolvedValue({
      hasNextCollectionMovie: false,
      nowShowing: null,
      posterReelMovies: [{ ...movie, poster_path: "/reel.jpg" }],
      watchedMovies: [movie],
    });

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await screen.findByRole("button", { name: "Choose a Movie" });
    await waitFor(() => expect(decode).toHaveBeenCalledOnce());
  });

  it("loads movie URLs directly and follows browser history", async () => {
    arrange(anonymous);
    vi.mocked(api.movie).mockImplementation(async (id) => {
      if (id === "missing-id") throw new ApiError("Movie not found", 404);
      return {
        movie: { ...movie, cast: [], directors: [], tmdb_id: 603 },
      };
    });
    window.history.replaceState(null, "", "/movies/movie-id");
    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Test Movie" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "View on TMDB" })).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/movie/603",
    );
    expect(api.home).not.toHaveBeenCalled();

    window.history.pushState(null, "", "/movies/missing-id");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Movie Not Found",
      }),
    ).toBeVisible();

    window.history.back();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Test Movie" }),
    ).toBeVisible();
  });

  it("confirms deletion from details and returns to the library", async () => {
    arrange(authenticated);
    vi.spyOn(api, "deleteMovie").mockResolvedValue({
      deleted: true,
      id: movie.id,
    });
    window.history.replaceState(null, "", "/movies/movie-id?from=library");
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Delete Movie" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "Delete Test Movie?",
    });
    expect(confirmation).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Delete Movie" }),
    ).toHaveLength(1);
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete Movie" }),
    );

    await waitFor(() => expect(window.location.pathname).toBe("/library"));
    expect(api.deleteMovie).toHaveBeenCalledWith("movie-id");
  });

  it("returns to Now Showing after deleting from that context", async () => {
    arrange(authenticated);
    vi.spyOn(api, "deleteMovie").mockResolvedValue({
      deleted: true,
      id: movie.id,
    });
    window.history.replaceState(null, "", "/movies/movie-id?from=now-showing");
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Delete Movie" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "Delete Test Movie?",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete Movie" }),
    );

    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("returns to the Manager's Office after deleting from that context", async () => {
    arrange(authenticated);
    vi.spyOn(api, "deleteMovie").mockResolvedValue({
      deleted: true,
      id: movie.id,
    });
    window.history.replaceState(
      null,
      "",
      "/movies/movie-id?from=manager-office",
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Delete Movie" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "Delete Test Movie?",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete Movie" }),
    );

    await waitFor(() =>
      expect(window.location.pathname).toBe("/manager-office"),
    );
  });

  it("expires authorization safely while saving collection order", async () => {
    arrange(authenticated);
    vi.mocked(api.authMe)
      .mockResolvedValueOnce(authenticated)
      .mockResolvedValueOnce(anonymous);
    vi.spyOn(api, "order").mockRejectedValue(
      new ApiError("Authentication required", 401),
    );
    window.history.replaceState(null, "", "/collections/collection-id");
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Test Saga" }),
    ).toBeVisible();
    expect(api.collection).toHaveBeenCalledWith("collection-id");
    await user.click(screen.getByRole("button", { name: "Save Order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session ended. Sign in again to make changes.",
    );
    expect(
      screen.getByRole("button", { name: "Sign In to Set the Order" }),
    ).toBeVisible();
    expect(api.order).toHaveBeenCalledWith("collection-id", ["movie-id"]);
  });
});
