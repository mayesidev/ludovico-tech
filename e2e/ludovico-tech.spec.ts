import { expect, test } from "@playwright/test";

test.describe.serial("Ludovico Tech browser workflows", () => {
  test("publishes a branded site favicon", async ({ page, request }) => {
    await page.goto("/");

    const favicon = page.locator('link[rel="icon"][type="image/svg+xml"]');
    await expect(favicon).toHaveAttribute("href", "/favicon.svg");

    const response = await request.get("/favicon.svg");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/svg+xml");
    const artwork = await response.text();
    expect(artwork).toContain('viewBox="0 0 64 64"');
    expect(artwork).toContain("Ludovico Tech film projector");
  });

  test("presents the project credits and required attribution", async ({
    page,
  }) => {
    await page.goto("/credits");

    await expect(page).toHaveURL(/\/credits$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Credits" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Ludovico Tech on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/mayesidev/ludovico-tech");
    await expect(page.getByText("Version", { exact: true })).toBeVisible();
    await expect(page.getByText("unversioned", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
      ),
    ).toBeVisible();
    await expect(page.locator("footer")).toHaveCount(0);
  });

  test("adds a movie, rolls it, and records its required rating", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Ludovico Tech");
    await expect(
      page.getByLabel("A Pop Culture Re-education Program"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "No Movie Selected" }),
    ).toBeVisible();
    const tmdbResponse = await page.request.get(
      "/api/tmdb/search?query=Browser%20Test%20Feature",
    );
    expect(tmdbResponse.status()).toBe(503);
    await expect(tmdbResponse.json()).resolves.toEqual({
      error: "TMDB is not configured",
    });
    await page.getByRole("button", { name: "Add a Movie" }).click();
    await page
      .getByRole("textbox", { name: "Movie title" })
      .fill("Browser Test Feature");
    await page.getByRole("button", { name: "Add Movie", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Test Feature" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/movies\/[^/]+$/);
    await page.getByRole("link", { name: "Now Showing" }).click();

    await page
      .getByRole("button", { name: "Choose a Movie", exact: true })
      .click();
    const reveal = page.getByRole("status");
    await expect(reveal).toContainText("Choosing a Movie");
    await expect(reveal).toBeHidden({
      timeout: 5_000,
    });

    await page.getByRole("slider", { name: "Rating" }).fill("4.5");
    await page
      .getByRole("textbox", { name: "Custom rating phrase (required)" })
      .fill("A browser-tested classic");
    await page.getByRole("button", { name: "Rate It", exact: true }).click();

    await expect(
      page.getByRole("heading", { level: 2, name: "Watched Movies" }),
    ).toBeVisible();
    await expect(
      page.getByText(/A browser-tested classic/).first(),
    ).toBeVisible();

    await page
      .getByRole("link", { name: "Browser Test Feature", exact: true })
      .click();
    await expect(page).toHaveURL(/\/movies\/[^?]+\?from=now-showing$/);
    await page.getByRole("link", { name: "Return to Now Showing" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page
      .getByRole("link", { name: "View details for Browser Test Feature" })
      .click();
    await expect(
      page.getByRole("link", { name: "Return to Now Showing" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Return to Now Showing" }).click();
  });

  test("orders and continues a collection, then rerolls with reduced motion", async ({
    page,
  }) => {
    await page.goto("/");

    for (const [index, title] of [
      "Browser Chapter One",
      "Browser Chapter Two",
      "Browser Chapter Three",
    ].entries()) {
      await page.getByRole("button", { name: "Add a Movie" }).click();
      await page.getByRole("textbox", { name: "Movie title" }).fill(title);
      const collection = page.getByRole("combobox", {
        name: "Collection (optional)",
      });
      await collection.fill(index === 1 ? "Browser" : "Browser Saga");
      if (index === 1) {
        await expect(
          page.locator('datalist option[value="Browser Saga"]'),
        ).toBeAttached();
        await collection.fill("Browser Saga");
      }
      await page
        .getByRole("button", { name: "Add Movie", exact: true })
        .click();
    }
    await page.getByRole("link", { name: "Now Showing" }).click();

    await page
      .getByRole("button", { name: "Choose the Next Movie", exact: true })
      .click();
    await expect(page.getByRole("status")).toBeHidden({
      timeout: 5_000,
    });
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Chapter One" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Browser Saga" }).click();
    await expect(page).toHaveURL(/\/collections\//);
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Saga" }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Move Browser Chapter Two Up" })
      .click();
    await page.getByRole("button", { name: "Save Order" }).click();
    await expect(page.getByRole("status")).toHaveText("Order saved.");
    await page.getByRole("link", { name: "Return to Now Showing" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Chapter Two" }),
    ).toBeVisible();

    await page.getByRole("slider", { name: "Rating" }).fill("4");
    await page
      .getByRole("textbox", { name: "Custom rating phrase (required)" })
      .fill("The second one goes first");
    await page.getByRole("button", { name: "Rate It" }).click();
    await page.getByRole("button", { name: "Continue Collection" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Chapter One" }),
    ).toBeVisible();

    await page.getByRole("slider", { name: "Rating" }).fill("3.5");
    await page
      .getByRole("textbox", { name: "Custom rating phrase (required)" })
      .fill("Back to chapter one");
    await page.getByRole("button", { name: "Rate It" }).click();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Choose Another Movie" }).click();
    const reveal = page.getByRole("status");
    await expect(reveal).toBeVisible();
    expect(
      await reveal.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("none");
    await expect(reveal).toBeHidden({ timeout: 5_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Chapter Three" }),
    ).toBeVisible();
  });

  test("edits a movie and collection from its details page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add a Movie" }).click();
    await page
      .getByRole("textbox", { name: "Movie title" })
      .fill("Browser Editable Movie");
    await page.getByRole("button", { name: "Add Movie", exact: true }).click();

    await page.getByRole("link", { name: "Library", exact: true }).click();
    await page
      .getByRole("link", { name: "Browser Editable Movie", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit Movie" }).click();
    await page
      .getByRole("textbox", { name: "Movie title" })
      .fill("Browser Edited Movie");
    await page
      .getByRole("textbox", { name: "Collection" })
      .fill("Browser Edit Saga");
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Edited Movie" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browser Edit Saga" }),
    ).toBeVisible();
    await expect(page.getByText("Collection")).toBeVisible();
  });

  test("confirms deletion of an unwatched movie from its details", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add a Movie" }).click();
    await page
      .getByRole("textbox", { name: "Movie title" })
      .fill("Browser Deletion Candidate");
    await page.getByRole("button", { name: "Add Movie", exact: true }).click();

    await page.getByRole("link", { name: "Library", exact: true }).click();
    await page
      .getByRole("link", { name: "Browser Deletion Candidate", exact: true })
      .click();
    await page.getByRole("button", { name: "Delete Movie" }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Delete Browser Deletion Candidate?",
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Delete Movie" }).click();

    await expect(page).toHaveURL(/\/library$/);
    await expect(
      page.getByRole("link", {
        name: "Browser Deletion Candidate",
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test("keeps the catalog browse-only when auth is anonymous", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          user: null,
          authenticated: false,
          local: false,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.goto("/");

    await expect(
      page.getByRole("button", { name: "Sign In", exact: true }),
    ).toBeVisible();
    const home = await page
      .getByRole("link", { name: "Ludovico Tech home" })
      .boundingBox();
    const nowShowing = await page
      .getByRole("link", { name: "Now Showing" })
      .boundingBox();
    const library = await page
      .getByRole("link", { name: "Library" })
      .boundingBox();
    const signIn = await page
      .getByRole("button", { name: "Sign In", exact: true })
      .boundingBox();

    expect(home).not.toBeNull();
    expect(nowShowing).not.toBeNull();
    expect(library).not.toBeNull();
    expect(signIn).not.toBeNull();
    expect(home!.x + home!.width).toBeLessThanOrEqual(signIn!.x);
    expect(signIn!.x + signIn!.width).toBeLessThanOrEqual(320);
    expect(signIn!.height).toBeLessThanOrEqual(44);
    expect(nowShowing!.y).toBeGreaterThan(home!.y);
    expect(library!.x + library!.width).toBeLessThanOrEqual(320);
    await expect(page.getByRole("button", { name: "Add a Movie" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Rate It" })).toHaveCount(0);
    expect(
      await page
        .getByRole("link", { name: "Now Showing" })
        .evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
    ).toBeGreaterThanOrEqual(18);
    await expect(page.getByText(/unwatched out of \d+ movies/)).toHaveCount(0);
    await page.getByRole("link", { name: "Library" }).click();
    await expect(
      page.getByText(/\d+ unwatched out of \d+ movies/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Order" })).toHaveCount(0);
    const titleSort = page.getByRole("button", { name: "Title" });
    const titleHeader = page.getByRole("columnheader", { name: /Title/ });
    const renderedTitles = page.locator("tbody tr td:first-child a");
    await expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
    const ascendingTitles = await renderedTitles.allTextContents();
    expect(ascendingTitles).toEqual(
      [...ascendingTitles].sort((left, right) => left.localeCompare(right)),
    );

    const descendingResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/library" &&
        url.searchParams.get("direction") === "desc" &&
        url.searchParams.get("sort") === "title" &&
        response.ok()
      );
    });
    await titleSort.click();
    await descendingResponse;
    await expect(titleHeader).toHaveAttribute("aria-sort", "descending");
    await expect
      .poll(() => renderedTitles.allTextContents())
      .toEqual([...ascendingTitles].reverse());
    await page.getByRole("link", { name: "Browser Test Feature" }).click();
    await expect(page).toHaveURL(/\/movies\//);
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Test Feature" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Test Feature" }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/library$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Library" }),
    ).toBeVisible();
  });

  test("keeps header identity and actions intact at intermediate widths", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          user: {
            displayName: "Invited User",
            email: "invited@example.test",
          },
          authenticated: true,
          local: false,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.goto("/credits");

    const title = page.getByText("Ludovico Tech", { exact: true });
    const tagline = page.getByLabel("A Pop Culture Re-education Program");
    const credits = page.getByRole("link", { name: "Credits" });
    const nowShowing = page.getByRole("link", { name: "Now Showing" });
    const signOut = page.getByRole("button", { name: "Sign Out Invited User" });

    await expect(tagline).toBeVisible();
    const titleBox = await title.boundingBox();
    const taglineBox = await tagline.boundingBox();
    const creditsBox = await credits.boundingBox();
    const nowShowingBox = await nowShowing.boundingBox();
    expect(titleBox).not.toBeNull();
    expect(taglineBox).not.toBeNull();
    expect(creditsBox).not.toBeNull();
    expect(nowShowingBox).not.toBeNull();
    expect(taglineBox!.width).toBeLessThanOrEqual(titleBox!.width + 1);
    expect(
      nowShowingBox!.x - (titleBox!.x + titleBox!.width),
    ).toBeGreaterThanOrEqual(32);
    expect(nowShowingBox!.x).toBeLessThan(creditsBox!.x);
    await expect(title).toHaveCSS("font-size", "20px");
    await expect(tagline).toHaveCSS("font-size", "14px");
    await expect(signOut).toHaveText("Sign Out");
    expect(
      await signOut.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);

    await page.setViewportSize({ width: 760, height: 700 });
    await expect(tagline).toBeHidden();
    const narrowCreditsBox = await credits.boundingBox();
    const narrowNowShowingBox = await nowShowing.boundingBox();
    const narrowSignOutBox = await signOut.boundingBox();
    expect(narrowCreditsBox).not.toBeNull();
    expect(narrowNowShowingBox).not.toBeNull();
    expect(narrowSignOutBox).not.toBeNull();
    expect(narrowNowShowingBox!.x).toBeLessThan(narrowCreditsBox!.x);
    expect(narrowCreditsBox!.y).toBeGreaterThan(titleBox!.y);
    expect(narrowSignOutBox!.x + narrowSignOutBox!.width).toBeLessThanOrEqual(
      760,
    );
  });

  test("starts browser login through the Google authorization route", async ({
    page,
  }) => {
    let returnTo: string | null = null;
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          user: null,
          authenticated: false,
          local: false,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/auth/google**", async (route) => {
      returnTo = new URL(route.request().url()).searchParams.get("returnTo");
      await route.fulfill({
        headers: {
          location: "http://127.0.0.1:5174/oauth-provider/google",
        },
        status: 302,
      });
    });
    await page.goto("/movies/movie-1?from=now-showing");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    await expect(page).toHaveURL("http://127.0.0.1:5174/oauth-provider/google");
    expect(returnTo).toBe("/movies/movie-1?from=now-showing");
  });
});
