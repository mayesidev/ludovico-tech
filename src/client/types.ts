export type Tab = "credits" | "home" | "library" | "tmdb-status";

export type Navigate = (path: string) => void;

export type ReturnTarget = "library" | "manager-office" | "now-showing";

export type RunAction = (
  action: () => Promise<unknown>,
  after?: () => void,
) => Promise<void>;
