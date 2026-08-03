import type { Movie } from "./api";

export type Tab = "home" | "library";

export type RunAction = (
  action: () => Promise<unknown>,
  after?: () => void,
) => Promise<void>;

export type MovieOrderState = {
  draft: Movie[];
  franchiseId: string;
};
