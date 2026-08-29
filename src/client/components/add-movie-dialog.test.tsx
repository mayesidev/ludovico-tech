import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError, type MovieDetail } from "../api";
import type { RunAction } from "../types";
import { AddMovieDialog } from "./add-movie-dialog";

const movie: MovieDetail = {
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: null,
  id: "added-id",
  imdb_id: null,
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: "2021-03-04",
  runtime_minutes: null,
  version: null,
  version_runtime: null,
  version_reference_url: null,
  title: "Matched Movie",
  tmdb_id: 42,
  watched_at: null,
  cast: [],
  directors: [],
};

const run: RunAction = async (action, after) => {
  await action();
  after?.();
};

describe("add movie dialog", () => {
  it("searches TMDB, confirms a candidate, and adds its identity", async () => {
    vi.spyOn(api, "tmdbSearch").mockResolvedValue({
      results: [
        {
          id: 42,
          posterPath: null,
          releaseDate: "2021-03-04",
          title: "Matched Movie",
        },
      ],
    });
    vi.spyOn(api, "addMovie").mockResolvedValue({ movie });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(
      <AddMovieDialog
        busy={false}
        onAuthExpired={vi.fn()}
        onClose={onClose}
        onCreated={onCreated}
        run={run}
      />,
    );

    const title = screen.getByRole("textbox", { name: "Movie title" });
    await waitFor(() => expect(title).toHaveFocus());
    expect(
      screen.getByRole("checkbox", { name: /Specify a Version/ }),
    ).toBeDisabled();
    await user.type(title, "Candidate");
    await user.type(
      screen.getByRole("textbox", { name: "Collection (optional)" }),
      "A Saga",
    );
    await user.type(
      screen.getByRole("textbox", { name: "IMDb ID or URL (optional)" }),
      "https://m.imdb.com/title/TT0133093/?ref_=fn_all_ttl_1",
    );
    await user.click(screen.getByRole("button", { name: "Search TMDB" }));
    await user.click(
      await screen.findByRole("button", { name: /Matched Movie/ }),
    );
    const versionToggle = screen.getByRole("checkbox", {
      name: /Specify a Version/,
    });
    expect(versionToggle).toBeEnabled();
    await user.click(versionToggle);
    const versionRuntime = screen.getByRole("spinbutton", {
      name: "Version Runtime (minutes)",
    });
    const versionReferenceUrl = screen.getByRole("textbox", {
      name: "Version Reference URL",
    });
    expect(versionRuntime).toBeDisabled();
    expect(versionReferenceUrl).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: "Version" }),
      "Director's Cut",
    );
    await user.type(versionRuntime, "112");
    await user.type(versionReferenceUrl, "https://example.com/cuts/42");
    await user.click(screen.getByRole("button", { name: "Add Movie" }));

    expect(api.addMovie).toHaveBeenCalledWith({
      collectionName: "A Saga",
      imdbId: "tt0133093",
      title: "Matched Movie",
      tmdbId: 42,
      version: "Director's Cut",
      versionReferenceUrl: "https://example.com/cuts/42",
      versionRuntime: 112,
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith(movie);
  });

  it("shows that the movie is being added until its confirmed detail returns", async () => {
    let confirmAdd!: (result: { movie: MovieDetail }) => void;
    vi.spyOn(api, "addMovie").mockReturnValue(
      new Promise((resolve) => {
        confirmAdd = resolve;
      }),
    );
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(
      <AddMovieDialog
        busy={false}
        onAuthExpired={vi.fn()}
        onClose={vi.fn()}
        onCreated={onCreated}
        run={run}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Movie title" }),
      "Pending Movie",
    );
    await user.click(screen.getByRole("button", { name: "Add Movie" }));

    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(onCreated).not.toHaveBeenCalled();

    confirmAdd({ movie });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(movie));
  });

  it("refreshes auth presentation when a TMDB search receives 401", async () => {
    vi.spyOn(api, "tmdbSearch").mockRejectedValue(
      new ApiError("Authentication required", 401),
    );
    const onAuthExpired = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <AddMovieDialog
        busy={false}
        onAuthExpired={onAuthExpired}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        run={run}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Movie title" }),
      "Movie",
    );
    await user.click(screen.getByRole("button", { name: "Search TMDB" }));

    expect(
      await screen.findByText(
        "Your session ended. Sign in again to search TMDB.",
      ),
    ).toHaveRole("alert");
    expect(onAuthExpired).toHaveBeenCalledOnce();
  });

  it("checks a manually entered TMDB ID before adding it", async () => {
    vi.spyOn(api, "tmdbMovie").mockResolvedValue({
      movie: {
        collection: null,
        id: 42,
        posterPath: null,
        releaseDate: "2021-03-04",
        runtimeMinutes: 97,
        title: "Matched Movie",
      },
    });
    vi.spyOn(api, "addMovie").mockResolvedValue({ movie });
    const user = userEvent.setup();
    render(
      <AddMovieDialog
        busy={false}
        onAuthExpired={vi.fn()}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        run={run}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Movie title" }),
      "Possible title",
    );
    await user.type(
      screen.getByRole("textbox", { name: "TMDB movie ID (optional)" }),
      "42",
    );
    await user.click(screen.getByRole("button", { name: "Check ID" }));

    expect(
      await screen.findByText("Confirmed: Matched Movie (TMDB #42)"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add Movie" }));
    expect(api.addMovie).toHaveBeenCalledWith({
      collectionName: "",
      imdbId: null,
      title: "Matched Movie",
      tmdbId: 42,
      version: null,
      versionReferenceUrl: null,
      versionRuntime: null,
    });
  });

  it("closes with Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AddMovieDialog
        busy={false}
        onAuthExpired={vi.fn()}
        onClose={onClose}
        onCreated={vi.fn()}
        run={run}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
