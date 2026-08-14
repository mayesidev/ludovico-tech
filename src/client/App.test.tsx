import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api, ApiError, type AuthState, type Movie } from "./api";
import {
  POSTER_REEL_DURATION_MS,
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
  actor: null,
  authenticated: false,
  local: false,
};

const authenticated: AuthState = {
  actor: { displayName: "Invited User", email: "invited@example.test" },
  authenticated: true,
  local: false,
};

const arrange = (auth: AuthState) => {
  vi.spyOn(api, "authMe").mockResolvedValue(auth);
  vi.spyOn(api, "movies").mockResolvedValue({ movies: [movie] });
  vi.spyOn(api, "nowShowing").mockResolvedValue({
    nowShowing: null,
    remainingCollectionMovies: [],
  });
};

describe("application authorization presentation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => vi.useRealTimers());

  it("lets anonymous visitors browse without rendering mutation controls", async () => {
    arrange(anonymous);
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "No movie selected",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Sign in$/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a movie" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a movie" })).toBeNull();

    const library = screen.getByRole("link", { name: "Library" });
    await user.click(library);
    expect(window.location.pathname).toBe("/library");
    expect(library).toHaveAttribute("aria-current", "page");
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
    expect(screen.getByRole("link", { name: "Now showing" })).toHaveAttribute(
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
      await screen.findByRole("button", { name: "Choose a movie" }),
    ).toBeVisible();
    const addMovie = screen.getByRole("button", { name: "Add a movie" });
    expect(addMovie).toBeVisible();
    await user.click(addMovie);
    expect(screen.getByRole("dialog", { name: "Add a movie" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close add movie" }));
    expect(addMovie).toHaveFocus();

    await user.click(screen.getByRole("link", { name: "Library" }));
    expect(window.location.pathname).toBe("/library");
    expect(screen.getByRole("button", { name: "Add a movie" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Test Movie" }));
    await user.click(screen.getByRole("button", { name: "Edit movie" }));
    expect(screen.getByRole("dialog", { name: "Edit movie" })).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("link", { name: "Return to Library" }));
    await user.click(
      screen.getByRole("button", { name: "Sign out Invited User" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Sign in$/ })).toBeVisible(),
    );
    expect(api.logout).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Choose a movie" })).toBeNull();
  });

  it("keeps add-movie failures visible and dismissible above the open dialog", async () => {
    arrange(authenticated);
    vi.spyOn(api, "addMovie").mockRejectedValue(
      new ApiError("That TMDB movie is already in the catalog", 409),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Add a movie" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add a movie" });
    const title = within(dialog).getByRole("textbox", { name: "Movie title" });
    await user.type(title, "Existing TMDB Movie");
    await user.click(within(dialog).getByRole("button", { name: "Add movie" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That TMDB movie is already in the catalog",
    );
    expect(alert).toHaveClass("fixed", "z-[60]");
    expect(alert.closest("[inert]")).toBeNull();
    expect(dialog).toBeVisible();
    expect(title).toHaveValue("Existing TMDB Movie");

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
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
      await screen.findByRole("button", { name: "Choose a movie" }),
    );

    expect(
      await screen.findByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent("Your session ended. Sign in again to make changes.");
    expect(screen.getByRole("button", { name: /^Sign in$/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Choose a movie" })).toBeNull();
    expect(api.authMe).toHaveBeenCalledTimes(2);
  });

  it("runs the poster reel before revealing the actual Now Showing movie", async () => {
    arrange(authenticated);
    vi.mocked(api.movies).mockResolvedValue({
      movies: [{ ...movie, poster_path: "/reel.jpg" }],
    });
    vi.spyOn(api, "roll").mockResolvedValue({
      rolledMovie: { ...movie, id: "rolled-id", title: "Rolled Later Movie" },
      nowShowing: {
        collection_id: "collection-id",
        collection_name: "Test Saga",
        id: 1,
        movie_id: "actual-id",
        poster_path: "/actual.jpg",
        rating_phrase: null,
        rating_score: null,
        release_date: null,
        rolled_movie_id: "rolled-id",
        status: "ready",
        title: "Actual First Movie",
        version: null,
        watched_at: null,
      },
    });
    render(<App />);

    const choose = await screen.findByRole("button", {
      name: "Choose a movie",
    });
    vi.useFakeTimers();
    fireEvent.click(choose);

    expect(screen.getByRole("status")).toHaveTextContent("Choosing a movie");
    await act(async () => {
      vi.advanceTimersByTime(POSTER_REEL_DURATION_MS);
      await Promise.resolve();
    });
    const reveal = screen.getByRole("status");
    expect(reveal).toHaveTextContent("Now showing: Actual First Movie");
    expect(
      within(reveal).getByAltText("Poster for Actual First Movie"),
    ).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(POSTER_REVEAL_DURATION_MS);
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("loads movie URLs directly and follows browser history", async () => {
    arrange(anonymous);
    vi.mocked(api.movies).mockResolvedValue({
      movies: [{ ...movie, tmdb_id: 603 }],
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

    window.history.pushState(null, "", "/movies/missing-id");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Movie not found",
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
      await screen.findByRole("button", { name: "Delete movie" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "Delete Test Movie?",
    });
    expect(confirmation).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Delete movie" }),
    ).toHaveLength(1);
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete movie" }),
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
      await screen.findByRole("button", { name: "Delete movie" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "Delete Test Movie?",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete movie" }),
    );

    await waitFor(() => expect(window.location.pathname).toBe("/"));
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
    await user.click(screen.getByRole("button", { name: "Save order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session ended. Sign in again to make changes.",
    );
    expect(
      screen.getByRole("button", { name: "Sign in to set the order" }),
    ).toBeVisible();
    expect(api.order).toHaveBeenCalledWith("collection-id", ["movie-id"]);
  });
});
