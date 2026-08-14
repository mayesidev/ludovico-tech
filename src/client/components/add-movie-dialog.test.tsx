import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError, type Movie } from "../api";
import type { RunAction } from "../types";
import { AddMovieDialog } from "./add-movie-dialog";

const movie: Movie = {
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: null,
  id: "added-id",
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
    const user = userEvent.setup();
    render(
      <AddMovieDialog
        busy={false}
        onAuthExpired={vi.fn()}
        onClose={onClose}
        run={run}
      />,
    );

    const title = screen.getByRole("textbox", { name: "Movie title" });
    await waitFor(() => expect(title).toHaveFocus());
    expect(
      screen.getByRole("checkbox", { name: /Specify a version/ }),
    ).toBeDisabled();
    await user.type(title, "Candidate");
    await user.type(
      screen.getByRole("textbox", { name: "Collection (optional)" }),
      "A Saga",
    );
    await user.click(screen.getByRole("button", { name: "Search TMDB" }));
    await user.click(
      await screen.findByRole("button", { name: /Matched Movie/ }),
    );
    const versionToggle = screen.getByRole("checkbox", {
      name: /Specify a version/,
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
    await user.click(screen.getByRole("button", { name: "Add movie" }));

    expect(api.addMovie).toHaveBeenCalledWith({
      collectionName: "A Saga",
      title: "Matched Movie",
      tmdbId: 42,
      version: "Director's Cut",
      versionReferenceUrl: "https://example.com/cuts/42",
      versionRuntime: 112,
    });
    expect(onClose).toHaveBeenCalledOnce();
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
    await user.click(screen.getByRole("button", { name: "Add movie" }));
    expect(api.addMovie).toHaveBeenCalledWith({
      collectionName: "",
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
        run={run}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
