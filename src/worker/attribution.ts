export const TMDB_REFRESH_ATTRIBUTION = "automation:tmdb-refresh";

const automationLabels: Record<string, string> = {
  "automation:catalog-import": "Catalog import",
  [TMDB_REFRESH_ATTRIBUTION]: "TMDB refresh automation",
};

export const attributionDisplayName = (
  attributionKey: string | null,
  userDisplayName: string | null,
  userEmail: string | null,
) => {
  if (attributionKey === null) return null;
  if (userDisplayName?.trim()) return userDisplayName.trim();
  if (userEmail?.trim()) return userEmail.trim();
  if (attributionKey === "local-developer") return "Local developer";
  return automationLabels[attributionKey] ?? "Unknown user";
};
