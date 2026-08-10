import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, type Movie, type NowShowing } from "../api";
import type { RunAction } from "../types";
import { HomePage } from "./home-page";

const movie = (overrides: Partial<Movie> = {}): Movie => ({
  added_at: "2026-08-07T00:00:00.000Z",
  franchise_id: null,
  id: "movie-id",
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: "2020-01-02",
  title: "Test Movie",
  tmdb_id: null,
  watched_at: null,
  ...overrides,
});

const nowShowing = (overrides: Partial<NowShowing> = {}): NowShowing => ({
  franchise_id: null,
  franchise_name: null,
  id: 1,
  movie_id: "movie-id",
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: "2020-01-02",
  rolled_movie_id: "movie-id",
  status: "ready",
  title: "Test Movie",
  watched_at: null,
  ...overrides,
});

const run: RunAction = async (action, after) => {
  await action();
  after?.();
};

const renderHome = (
  overrides: Partial<Parameters<typeof HomePage>[0]> = {},
) => {
  const props: Parameters<typeof HomePage>[0] = {
    busy: false,
    canMutate: true,
    movies: [movie()],
    nowShowing: nowShowing(),
    onLogin: vi.fn(),
    onNavigate: vi.fn(),
    remaining: [],
    roll: vi.fn(),
    run,
    ...overrides,
  };
  return { props, ...render(<HomePage {...props} />) };
};

describe("home workflows", () => {
  it("requires both the half-point rating and custom phrase", async () => {
    vi.spyOn(api, "rate").mockResolvedValue({ nowShowing: nowShowing() });
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("button", { name: "Rate it" }));
    expect(screen.getByText("Choose a rating from 0 to 5.")).toHaveRole(
      "alert",
    );
    expect(screen.getByText("Add the custom rating phrase.")).toHaveRole(
      "alert",
    );
    expect(api.rate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "4.5" }));
    await user.type(
      screen.getByRole("textbox", { name: "Custom rating phrase (required)" }),
      "  A custom classic  ",
    );
    await user.click(screen.getByRole("button", { name: "Rate it" }));

    expect(api.rate).toHaveBeenCalledWith("movie-id", 4.5, "A custom classic");
  });

  it("orders the linked title, poster, and rating controls", () => {
    renderHome();

    const title = screen.getByRole("heading", {
      level: 1,
      name: "Test Movie (2020)",
    });
    const poster = screen.getByRole("img", {
      name: "No poster available for Test Movie",
    });
    const phrase = screen.getByRole("textbox", {
      name: "Custom rating phrase (required)",
    });

    expect(
      screen.getByRole("link", { name: "Test Movie (2020)" }),
    ).toHaveAttribute("href", "/movies/movie-id");
    expect(
      title.compareDocumentPosition(poster) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      poster.compareDocumentPosition(phrase) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(phrase).toHaveAttribute("placeholder", "whats?");
  });

  it("offers series continuation or a fresh roll after a watched title", async () => {
    vi.spyOn(api, "next").mockResolvedValue({
      nowShowing: nowShowing({ movie_id: "second-id" }),
    });
    const roll = vi.fn();
    const user = userEvent.setup();
    renderHome({
      nowShowing: nowShowing({
        franchise_id: "franchise-id",
        franchise_name: "Test Saga",
        rating_phrase: "Worth continuing",
        rating_score: 4,
        status: "watched",
      }),
      remaining: [movie({ franchise_id: "franchise-id", id: "second-id" })],
      roll,
    });

    expect(
      screen.getByText(
        (_, element) => element?.textContent === "“Worth continuing”",
      ),
    ).toBeVisible();
    expect(screen.queryByText("4/5")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Continue series" }));
    await user.click(
      screen.getByRole("button", { name: "Choose another movie" }),
    );

    expect(api.next).toHaveBeenCalledOnce();
    expect(roll).toHaveBeenCalledOnce();
  });

  it("requires franchise order confirmation before rating", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderHome({
      nowShowing: nowShowing({
        franchise_id: "franchise-id",
        franchise_name: "Test Saga",
        status: "pending_order",
      }),
      onNavigate,
    });

    expect(screen.queryByRole("button", { name: "Rate it" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Choose the next movie" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Confirm franchise order" }),
    );
    expect(onNavigate).toHaveBeenCalledWith(
      "/franchises/franchise-id?from=now-showing",
    );
    expect(screen.getByRole("link", { name: "Test Saga" })).toHaveAttribute(
      "href",
      "/franchises/franchise-id?from=now-showing",
    );
  });

  it("renders no mutation controls for browse-only visitors", () => {
    renderHome({ canMutate: false });

    expect(screen.queryByRole("button", { name: "Rate it" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a movie" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Choose the next movie" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Test Movie (2020)" }),
    ).toBeVisible();
  });

  it("uses the current title as the primary page heading", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { level: 1, name: "Test Movie (2020)" }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByText("Weekly screening")).toBeNull();
    expect(screen.queryByText("What’s on the marquee?")).toBeNull();
    expect(screen.queryByText(/Roll the list/)).toBeNull();
  });

  it("places the relevant sign-in action with protected movie controls", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    renderHome({ canMutate: false, onLogin });

    await user.click(
      screen.getByRole("button", { name: "Sign in to rate this movie" }),
    );

    expect(onLogin).toHaveBeenCalledOnce();
  });

  it("renders one aligned empty history state without fake entries", () => {
    renderHome({ movies: [] });

    expect(
      screen.getByRole("heading", { level: 2, name: "Watched movies" }),
    ).toBeVisible();
    expect(screen.getByText("No movies have been rated yet.")).toBeVisible();
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(screen.queryByText("More history")).toBeNull();
  });

  it("shows only real watched entries and links their cards to details", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderHome({
      movies: [
        movie({
          id: "rated-id",
          rating_phrase: "A real rating",
          rating_score: 4,
          title: "Rated Movie",
        }),
        movie({ id: "unwatched-id", title: "Unwatched Movie" }),
      ],
      onNavigate,
    });

    expect(
      screen.getByRole("heading", { level: 3, name: "Rated Movie" }),
    ).toBeVisible();
    expect(screen.getAllByText("Rated Movie")).toHaveLength(1);
    expect(
      screen.getByRole("img", {
        name: "No poster available for Rated Movie",
      }),
    ).toBeVisible();
    expect(screen.getByText("4 · A real rating")).toBeVisible();
    expect(screen.queryByText("4/5")).toBeNull();
    expect(screen.queryByText("Unwatched Movie")).toBeNull();
    const detailsLink = screen.getByRole("link", {
      name: "View details for Rated Movie",
    });
    expect(detailsLink).toHaveAttribute("href", "/movies/rated-id");
    await user.click(detailsLink);
    expect(onNavigate).toHaveBeenCalledWith("/movies/rated-id");
  });

  it("distinguishes the whole catalog from its unwatched subset", () => {
    renderHome({
      movies: [
        movie({ id: "rated-id", rating_phrase: "Seen", rating_score: 3 }),
        movie({ id: "unwatched-id", rating_score: null }),
      ],
    });

    expect(screen.getByText("1 unwatched out of 2 movies")).toBeVisible();
  });

  it("centers the current poster below its title", () => {
    renderHome();

    const title = screen.getByRole("heading", {
      level: 1,
      name: "Test Movie (2020)",
    });
    const poster = screen.getByRole("img", {
      name: "No poster available for Test Movie",
    });

    expect(title.compareDocumentPosition(poster)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(poster.parentElement).toHaveClass("mx-auto");
    expect(title.parentElement).toHaveClass("text-center");
  });

  it("places the franchise below the linked title", () => {
    renderHome({
      nowShowing: nowShowing({
        franchise_id: "franchise-id",
        franchise_name: "Test Saga",
      }),
    });

    const title = screen.getByRole("heading", {
      level: 1,
      name: "Test Movie (2020)",
    });
    const franchise = screen.getByRole("link", { name: "Test Saga" });
    expect(title.compareDocumentPosition(franchise)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
