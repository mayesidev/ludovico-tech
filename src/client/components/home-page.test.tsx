import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, type Movie, type NowShowing } from "../api";
import type { RunAction } from "../types";
import { HomePage } from "./home-page";

const movie = (overrides: Partial<Movie> = {}): Movie => ({
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: null,
  id: "movie-id",
  imdb_id: null,
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: "2020-01-02",
  runtime_minutes: null,
  version: null,
  version_runtime: null,
  version_reference_url: null,
  title: "Test Movie",
  tmdb_id: null,
  watched_at: null,
  ...overrides,
});

const nowShowing = (overrides: Partial<NowShowing> = {}): NowShowing => ({
  cast: [],
  collection_id: null,
  collection_name: null,
  directors: [],
  id: 1,
  movie_id: "movie-id",
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: "2020-01-02",
  rolled_movie_id: "movie-id",
  status: "ready",
  title: "Test Movie",
  version: null,
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
  it("appends a specified version to the current title", () => {
    renderHome({
      nowShowing: nowShowing({
        title: "Batman",
        version: "Director's Cut",
      }),
    });

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Batman (Director's Cut) (2020)",
      }),
    ).toBeVisible();
    expect(
      screen.getByLabelText("No poster available for Batman (Director's Cut)"),
    ).toBeVisible();
    expect(
      screen
        .getByLabelText("No poster available for Batman (Director's Cut)")
        .querySelector(".lucide-ticket"),
    ).not.toBeNull();
  });

  it("shows the persisted top cast and directors for at-a-glance recognition", () => {
    renderHome({
      nowShowing: nowShowing({
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
      }),
    });

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
    renderHome();

    expect(screen.queryByText("Directed by")).toBeNull();
    expect(screen.queryByText("Starring")).toBeNull();
  });

  it("lets a single available credit field use the full row", () => {
    renderHome({
      nowShowing: nowShowing({
        cast: [{ tmdbId: 1, name: "Only Actor" }],
      }),
    });

    expect(screen.getByText("Starring").closest("dl")).toHaveClass(
      "feature-credits-single",
    );
  });

  it("exposes title length for responsive feature-title scaling", () => {
    const title =
      "Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb";
    renderHome({ nowShowing: nowShowing({ title }) });

    expect(screen.getByRole("heading", { level: 1 })).toHaveStyle({
      "--movie-title-length": String(title.length),
    });
  });

  it("selects a half-point rating with a slider and requires the custom phrase", async () => {
    vi.spyOn(api, "rate").mockResolvedValue({ nowShowing: nowShowing() });
    const user = userEvent.setup();
    renderHome();

    const slider = screen.getByRole("slider", { name: "Rating" });
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "5");
    expect(slider).toHaveAttribute("step", "0.5");
    expect(slider).toHaveValue("2.5");
    await user.click(screen.getByRole("button", { name: "Rate It" }));
    expect(screen.getByText("Add the custom rating phrase.")).toHaveRole(
      "alert",
    );
    expect(api.rate).not.toHaveBeenCalled();

    fireEvent.change(slider, { target: { value: "4.5" } });
    expect(slider).toHaveValue("4.5");
    expect(screen.getByLabelText("Selected rating")).toHaveTextContent("4.5");
    await user.type(
      screen.getByRole("textbox", { name: "Custom rating phrase (required)" }),
      "  A custom classic  ",
    );
    await user.click(screen.getByRole("button", { name: "Rate It" }));

    expect(api.rate).toHaveBeenCalledWith("movie-id", 4.5, "A custom classic");
    expect(screen.queryByText("4.5/5")).toBeNull();
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
    ).toHaveAttribute("href", "/movies/movie-id?from=now-showing");
    expect(
      poster.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      title.compareDocumentPosition(phrase) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(phrase).toHaveAttribute("placeholder", "whats?");
  });

  it("offers collection continuation or a fresh roll after a watched title", async () => {
    vi.spyOn(api, "next").mockResolvedValue({
      nowShowing: nowShowing({ movie_id: "second-id" }),
    });
    const roll = vi.fn();
    const user = userEvent.setup();
    renderHome({
      nowShowing: nowShowing({
        collection_id: "collection-id",
        collection_name: "Test Saga",
        rating_phrase: "Worth continuing",
        rating_score: 4,
        status: "watched",
      }),
      remaining: [movie({ collection_id: "collection-id", id: "second-id" })],
      roll,
    });

    expect(screen.getByText("Worth continuing")).toBeVisible();
    expect(screen.queryByText("4/5")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Continue Collection" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Choose Another Movie" }),
    );

    expect(api.next).toHaveBeenCalledOnce();
    expect(roll).toHaveBeenCalledOnce();
  });

  it("allows rating before a custom collection order is saved", () => {
    const onNavigate = vi.fn();
    renderHome({
      nowShowing: nowShowing({
        collection_id: "collection-id",
        collection_name: "Test Saga",
        status: "ready",
      }),
      onNavigate,
    });

    expect(screen.getByRole("button", { name: "Rate It" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Confirm collection order" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Test Saga" })).toHaveAttribute(
      "href",
      "/collections/collection-id?from=now-showing",
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("renders no mutation controls for browse-only visitors", () => {
    renderHome({ canMutate: false });

    expect(screen.queryByRole("button", { name: "Rate It" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a Movie" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Choose the Next Movie" }),
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
      screen.getByRole("button", { name: "Sign In to Rate This Movie" }),
    );

    expect(onLogin).toHaveBeenCalledOnce();
  });

  it("renders one aligned empty history state without fake entries", () => {
    renderHome({ movies: [] });

    expect(
      screen.getByRole("heading", { level: 2, name: "Watched Movies" }),
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
    expect(detailsLink).toHaveAttribute(
      "href",
      "/movies/rated-id?from=now-showing",
    );
    await user.click(detailsLink);
    expect(onNavigate).toHaveBeenCalledWith(
      "/movies/rated-id?from=now-showing",
    );
  });

  it("keeps the catalog summary and decorative status labels out of the feature", () => {
    renderHome({
      movies: [
        movie({ id: "rated-id", rating_phrase: "Seen", rating_score: 3 }),
        movie({ id: "unwatched-id", rating_score: null }),
      ],
    });

    expect(screen.queryByText("1 unwatched out of 2 movies")).toBeNull();
    expect(screen.queryByText("Now Showing", { selector: "p" })).toBeNull();
  });

  it("places the framed poster before the title", () => {
    renderHome();

    const title = screen.getByRole("heading", {
      level: 1,
      name: "Test Movie (2020)",
    });
    const poster = screen.getByRole("img", {
      name: "No poster available for Test Movie",
    });

    expect(poster.compareDocumentPosition(title)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(poster.closest(".poster-frame")).not.toBeNull();
  });

  it("places the collection below the linked title", () => {
    renderHome({
      nowShowing: nowShowing({
        collection_id: "collection-id",
        collection_name: "Test Saga",
      }),
    });

    const title = screen.getByRole("heading", {
      level: 1,
      name: "Test Movie (2020)",
    });
    const collection = screen.getByRole("link", { name: "Test Saga" });
    expect(title.compareDocumentPosition(collection)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
