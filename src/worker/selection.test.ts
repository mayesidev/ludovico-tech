import { describe, expect, it } from "vitest";
import { selectQueuedMovie } from "./selection";

const movie = (id: string, franchiseId: string | null) => ({
  franchise_id: franchiseId,
  id,
});

describe("franchise queue selection", () => {
  it("keeps a standalone roll unchanged", () => {
    const rolled = movie("standalone", null);
    expect(selectQueuedMovie(rolled, true, [])).toBe(rolled);
  });

  it("waits for user ordering when franchise order is unknown", () => {
    const rolled = movie("rolled-member", "franchise");
    const first = movie("first-member", "franchise");
    expect(selectQueuedMovie(rolled, false, [first, rolled])).toBe(rolled);
  });

  it("queues the first unwatched user-ordered member, not the rolled member", () => {
    const rolled = movie("rolled-later-member", "franchise");
    const first = movie("first-unwatched-member", "franchise");
    expect(selectQueuedMovie(rolled, true, [first, rolled])).toBe(first);
  });
});
