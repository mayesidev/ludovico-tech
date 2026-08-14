import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Movie } from "../api";
import { POSTER_REEL_INTERVAL_MS } from "../lib/poster-reel";
import { AppHeader, RollReveal } from "./app-shell";

const reelMovie = (id: string): Movie => ({
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: null,
  id,
  poster_path: `/${id}.jpg`,
  rating_phrase: null,
  rating_score: null,
  release_date: null,
  runtime_minutes: null,
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
      screen.getByText("A Pop Culture Re-education Program"),
    ).toBeVisible();
    expect(screen.queryByText("The watch club")).toBeNull();
  });

  it("keeps Credits with the site identity and outside primary actions", () => {
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
    const signIn = screen.getByRole("button", { name: "Sign in" });

    expect(credits).toHaveAttribute("aria-current", "page");
    expect(credits.closest("nav")).toBeNull();
    expect(
      credits.compareDocumentPosition(primaryNavigation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      primaryNavigation.compareDocumentPosition(signIn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("random selection reveal", () => {
  it("cycles through the prepared poster reel without repeatedly announcing titles", () => {
    vi.useFakeTimers();
    render(
      <RollReveal
        reel={[reelMovie("one"), reelMovie("two")]}
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
        selected={null}
      />,
    );

    act(() => vi.advanceTimersByTime(POSTER_REEL_INTERVAL_MS * 2));

    expect(screen.getByAltText("Poster for Movie one")).toBeInTheDocument();
    expect(screen.queryByAltText("Poster for Movie two")).toBeNull();
  });
});
