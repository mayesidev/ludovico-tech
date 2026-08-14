const imdbIdPattern = /^tt\d{6,9}$/i;
const imdbHosts = new Set(["imdb.com", "www.imdb.com", "m.imdb.com"]);

export const parseImdbId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (imdbIdPattern.test(trimmed)) return trimmed.toLowerCase();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !imdbHosts.has(url.hostname) ||
    url.port
  ) {
    return undefined;
  }

  const match = url.pathname.match(/^\/title\/(tt\d{6,9})\/?$/i);
  return match?.[1]?.toLowerCase();
};

export const imdbTitleUrl = (imdbId: string) =>
  `https://www.imdb.com/title/${imdbId}/`;
