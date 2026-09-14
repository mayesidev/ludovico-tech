import { useRef, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError, type TmdbMovieDetail, type TmdbResult } from "../api";
import { TmdbMovieFields } from "./tmdb-movie-fields";

const candidate: TmdbMovieDetail = {
  id: 7,
  title: "Chosen Movie",
  posterPath: null,
  releaseDate: null,
  collection: null,
  runtimeMinutes: null,
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function Harness({
  onAuthExpired = async () => {},
  onSave = () => {},
}: {
  onAuthExpired?: () => Promise<void>;
  onSave?: (value: { title: string; tmdbId: string }) => void;
}) {
  const [title, setTitle] = useState("Candidate");
  const [tmdbId, setTmdbId] = useState("42");
  const titleInputRef = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ title, tmdbId });
      }}
    >
      <TmdbMovieFields
        title={title}
        tmdbId={tmdbId}
        onTitleChange={setTitle}
        onTmdbIdChange={setTmdbId}
        titleInputRef={titleInputRef}
        onAuthExpired={onAuthExpired}
      />
      <button type="submit">Save</button>
    </form>
  );
}

const titleInput = () => screen.getByRole("textbox", { name: "Movie title" });
const idInput = () =>
  screen.getByRole("textbox", { name: "TMDB movie ID (optional)" });

describe("TMDB choice and lookup lifetime", () => {
  it.each(["title", "ID", "Remove Match"])(
    "discards a pending check after %s changes the choice",
    async (change) => {
      const pending = deferred<{ movie: TmdbMovieDetail }>();
      vi.spyOn(api, "tmdbMovie").mockReturnValue(pending.promise);
      const onSave = vi.fn();
      render(<Harness onSave={onSave} />);
      fireEvent.click(screen.getByRole("button", { name: "Check ID" }));
      if (change === "title") {
        fireEvent.change(titleInput(), { target: { value: "New title" } });
      } else if (change === "ID") {
        fireEvent.change(idInput(), { target: { value: "9" } });
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Remove Match" }));
        expect(titleInput()).toHaveFocus();
      }
      await act(async () => pending.resolve({ movie: candidate }));
      const expected = {
        title: change === "title" ? "New title" : "Candidate",
        tmdbId: change === "ID" ? "9" : "",
      };
      expect(titleInput()).toHaveValue(expected.title);
      expect(idInput()).toHaveValue(expected.tmdbId);
      expect(screen.queryByText(/Confirmed:/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expected);
    },
  );

  it("keeps optional manual checking recoverable and permits another search choice", async () => {
    const check = vi
      .spyOn(api, "tmdbMovie")
      .mockRejectedValueOnce(new Error("Movie not found"))
      .mockResolvedValueOnce({ movie: candidate });
    vi.spyOn(api, "tmdbSearch").mockResolvedValue({
      results: [{ ...candidate, id: 9, title: "Another Movie" }],
    });
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Check ID" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Movie not found",
    );
    fireEvent.change(idInput(), { target: { value: "7" } });
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Check ID" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Confirmed: Chosen Movie (TMDB #7)",
    );
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Check ID" })).toBeNull();
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove Match" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(titleInput()).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Search TMDB" }));
    await user.click(
      await screen.findByRole("button", { name: /Another Movie/ }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      title: "Another Movie",
      tmdbId: "9",
    });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "error"])(
    "ignores an older search %s after a newer choice",
    async (outcome) => {
      const old = deferred<{ results: TmdbResult[] }>();
      vi.spyOn(api, "tmdbSearch")
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce({ results: [candidate] });
      render(<Harness />);
      fireEvent.click(screen.getByRole("button", { name: "Search TMDB" }));
      fireEvent.change(titleInput(), { target: { value: "New query" } });
      fireEvent.click(screen.getByRole("button", { name: "Search TMDB" }));
      fireEvent.click(
        await screen.findByRole("button", { name: /Chosen Movie/ }),
      );
      await act(async () => {
        if (outcome === "success")
          old.resolve({ results: [{ ...candidate, title: "Old result" }] });
        else old.reject(new Error("Old failure"));
      });
      expect(titleInput()).toHaveValue("Chosen Movie");
      expect(idInput()).toHaveValue("7");
      expect(
        screen.queryByRole("button", { name: /Chosen Movie|Old result/ }),
      ).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("does not reopen the list when an existing result is chosen during another search", async () => {
    const next = deferred<{ results: TmdbResult[] }>();
    vi.spyOn(api, "tmdbSearch")
      .mockResolvedValueOnce({ results: [candidate] })
      .mockReturnValueOnce(next.promise);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Search TMDB" }));
    const result = await screen.findByRole("button", { name: /Chosen Movie/ });
    fireEvent.click(screen.getByRole("button", { name: "Search TMDB" }));
    fireEvent.click(result);
    await act(async () => next.resolve({ results: [candidate] }));
    expect(screen.queryByRole("button", { name: /Chosen Movie/ })).toBeNull();
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it.each(["success", "401"])(
    "ignores a check's stale %s after selecting a search result",
    async (outcome) => {
      const pending = deferred<{ movie: TmdbMovieDetail }>();
      vi.spyOn(api, "tmdbMovie").mockReturnValue(pending.promise);
      vi.spyOn(api, "tmdbSearch").mockResolvedValue({ results: [candidate] });
      const onAuthExpired = vi.fn().mockResolvedValue(undefined);
      render(<Harness onAuthExpired={onAuthExpired} />);
      fireEvent.click(screen.getByRole("button", { name: "Check ID" }));
      fireEvent.click(screen.getByRole("button", { name: "Search TMDB" }));
      fireEvent.click(
        await screen.findByRole("button", { name: /Chosen Movie/ }),
      );
      await act(async () => {
        if (outcome === "success")
          pending.resolve({
            movie: { ...candidate, id: 42, title: "Old movie" },
          });
        else pending.reject(new ApiError("Expired", 401));
      });
      expect(titleInput()).toHaveValue("Chosen Movie");
      expect(idInput()).toHaveValue("7");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(onAuthExpired).not.toHaveBeenCalled();
    },
  );

  it("ignores errors after unmounting", async () => {
    const pending = deferred<{ results: TmdbResult[] }>();
    vi.spyOn(api, "tmdbSearch").mockReturnValue(pending.promise);
    const onAuthExpired = vi.fn().mockResolvedValue(undefined);
    const view = render(<Harness onAuthExpired={onAuthExpired} />);
    fireEvent.click(screen.getByRole("button", { name: "Search TMDB" }));
    view.unmount();
    await act(async () => pending.reject(new ApiError("Expired", 401)));
    expect(onAuthExpired).not.toHaveBeenCalled();
  });

  it("does not show an obsolete error after authentication refresh finishes", async () => {
    const refresh = deferred<void>();
    vi.spyOn(api, "tmdbSearch").mockRejectedValue(new ApiError("Expired", 401));
    const onAuthExpired = vi.fn().mockReturnValue(refresh.promise);
    render(<Harness onAuthExpired={onAuthExpired} />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Search TMDB" })),
    );
    expect(onAuthExpired).toHaveBeenCalledOnce();
    fireEvent.change(titleInput(), { target: { value: "New query" } });
    await act(async () => refresh.resolve());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(titleInput()).toHaveValue("New query");
  });
});
