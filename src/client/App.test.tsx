import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api, ApiError, type AuthState, type Movie } from "./api";

const movie: Movie = {
  added_at: "2026-08-07T00:00:00.000Z",
  franchise_id: "franchise-id",
  franchise_name: "Test Saga",
  franchise_position: 1,
  id: "movie-id",
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: null,
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
    remainingFranchiseMovies: [],
  });
};

describe("application authorization presentation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

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

    const library = screen.getByRole("button", { name: "Library" });
    await user.click(library);
    expect(library).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Test Movie")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Order" })).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Ludovico Tech home" }),
    );
    expect(screen.getByRole("button", { name: "Now showing" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows contributor controls to an authenticated visitor and logs out safely", async () => {
    arrange(authenticated);
    vi.spyOn(api, "logout").mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Choose a movie" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add a movie" })).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Sign out Invited User" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Sign in$/ })).toBeVisible(),
    );
    expect(api.logout).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Choose a movie" })).toBeNull();
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
});
