import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppHeader, Footer } from "./app-shell";

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
});

describe("TMDB attribution", () => {
  it("shows the approved provider identity and required notice", () => {
    render(<Footer />);

    const link = screen.getByRole("link", { name: "The Movie Database" });
    expect(link).toHaveAttribute("href", "https://www.themoviedb.org/");
    expect(screen.getByAltText("TMDB")).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:image\/svg\+xml/),
    );
    expect(
      screen.getByText(
        "This product uses the TMDB API but is not endorsed or certified by TMDB.",
      ),
    ).toBeInTheDocument();
  });
});
