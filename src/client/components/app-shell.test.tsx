import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Footer } from "./app-shell";

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
