import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Movie } from "../api";
import { POSTER_REEL_INTERVAL_MS } from "../lib/poster-reel";
import { AppHeader, RollReveal } from "./app-shell";

const reelMovie = (id: string): Movie => ({
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: null,
  id,
  imdb_id: null,
  poster_path: `/${id}.jpg`,
  rating_phrase: null,
  rating_score: null,
  release_date: null,
  runtime_minutes: null,
  version: null,
  version_runtime: null,
  version_reference_url: null,
  title: `Movie ${id}`,
  tmdb_id: null,
  watched_at: null,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("site identity", () => {
  it("shows the Ludovico Tech name and program subtitle", () => {
    render(
      <AppHeader
        auth={null}
        onLogin={vi.fn()}
        onLogout={vi.fn()}
        onNavigate={vi.fn()}
        tab="home"
      />,
    );

    expect(screen.getByText("Ludovico Tech")).toBeVisible();
    expect(
      screen.getByLabelText("A Pop Culture Re-education Program"),
    ).toBeVisible();
    expect(screen.queryByText("The watch club")).toBeNull();
  });

  it("keeps Credits in the primary navigation before authentication controls", () => {
    render(
      <AppHeader
        auth={{ actor: null, authenticated: false, local: false }}
        onLogin={vi.fn()}
        onLogout={vi.fn()}
        onNavigate={vi.fn()}
        tab="credits"
      />,
    );

    const credits = screen.getByRole("link", { name: "Credits" });
    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    const signIn = screen.getByRole("button", { name: "Sign In" });

    expect(credits).toHaveAttribute("aria-current", "page");
    expect(credits.closest("nav")).toBe(primaryNavigation);
    expect(
      primaryNavigation.compareDocumentPosition(signIn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("random selection reveal", () => {
  it("uses an intentional ticket placeholder before a reel is available", () => {
    const { container } = render(
      <RollReveal reel={[]} starting={null} selected={null} />,
    );

    expect(container.querySelector(".lucide-ticket")).not.toBeNull();
    expect(container.querySelector(".lucide-clapperboard")).toBeNull();
  });

  it("shows the current movie until the decoded reel is available", () => {
    const { rerender } = render(
      <RollReveal
        reel={[]}
        starting={{ posterPath: "/current.jpg", title: "Current Movie" }}
        selected={null}
      />,
    );

    expect(screen.getByAltText("Poster for Current Movie")).toHaveAttribute(
      "src",
      "https://image.tmdb.org/t/p/w500/current.jpg",
    );
    expect(document.querySelector(".lucide-ticket")).toBeNull();

    rerender(
      <RollReveal
        reel={[reelMovie("one")]}
        starting={{ posterPath: "/current.jpg", title: "Current Movie" }}
        selected={null}
      />,
    );

    expect(screen.getByAltText("Poster for Movie one")).toHaveAttribute(
      "src",
      "https://image.tmdb.org/t/p/w342/one.jpg",
    );
    expect(screen.queryByAltText("Poster for Current Movie")).toBeNull();
  });

  it("cycles through the prepared poster reel without repeatedly announcing titles", () => {
    vi.useFakeTimers();
    render(
      <RollReveal
        reel={[reelMovie("one"), reelMovie("two")]}
        starting={null}
        selected={null}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Choosing a movie");
    expect(screen.getByAltText("Poster for Movie one")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(POSTER_REEL_INTERVAL_MS));

    expect(screen.getByAltText("Poster for Movie two")).toBeInTheDocument();
    expect(
      screen.getByText("Choosing a movie", { selector: ".sr-only" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Movie two", { selector: ".sr-only" }),
    ).toBeNull();
  });

  it("announces and displays the actual Now Showing result", () => {
    render(
      <RollReveal
        reel={[reelMovie("rolled")]}
        starting={null}
        selected={{ posterPath: "/actual.jpg", title: "Actual First Movie" }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Now showing: Actual First Movie",
    );
    expect(
      screen.getByAltText("Poster for Actual First Movie"),
    ).toBeInTheDocument();
  });

  it("does not rapidly cycle posters when reduced motion is requested", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    render(
      <RollReveal
        reel={[reelMovie("one"), reelMovie("two")]}
        starting={null}
        selected={null}
      />,
    );

    act(() => vi.advanceTimersByTime(POSTER_REEL_INTERVAL_MS * 2));

    expect(screen.getByAltText("Poster for Movie one")).toBeInTheDocument();
    expect(screen.queryByAltText("Poster for Movie two")).toBeNull();
  });
});
