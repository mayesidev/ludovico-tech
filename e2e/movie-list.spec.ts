import { expect, test } from "@playwright/test";

test("adds a movie, rolls it, and records its final rating", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "What’s on the marquee?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add a movie" }).click();
  await page.getByPlaceholder("Movie title").fill("Browser Test Feature");
  await page.getByRole("button", { name: "Add movie", exact: true }).click();

  await page.getByRole("button", { name: "Roll next", exact: true }).click();
  await expect(page.getByText("The roll is in")).toBeHidden({ timeout: 5_000 });

  await page.getByRole("button", { name: "4.5", exact: true }).click();
  await page
    .getByPlaceholder("Give it a goofy phrase…")
    .fill("A browser-tested classic");
  await page.getByRole("button", { name: "Rate it", exact: true }).click();

  await expect(page.getByText(/Unknown date · Watched/)).toBeVisible();
  await expect(
    page.getByText(/A browser-tested classic/).first(),
  ).toBeVisible();
});
