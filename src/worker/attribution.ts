export const TMDB_REFRESH_ACTOR = "automation:tmdb-refresh";

const automationLabels: Record<string, string> = {
  "automation:catalog-import": "Catalog import",
  [TMDB_REFRESH_ACTOR]: "TMDB refresh automation",
};

export const attributionActorName = (
  actorId: string | null,
  displayName: string | null,
  email: string | null,
) => {
  if (actorId === null) return null;
  if (displayName?.trim()) return displayName.trim();
  if (email?.trim()) return email.trim();
  if (actorId === "local-developer") return "Local developer";
  return automationLabels[actorId] ?? "Unknown user";
};
