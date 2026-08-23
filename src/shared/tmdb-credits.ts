export type TmdbPerson = {
  id: number;
  name: string;
};

export type TmdbCredits = {
  cast: TmdbPerson[];
  directors: TmdbPerson[];
};

export const parseTmdbPerson = (value: unknown): TmdbPerson | null => {
  if (!value || typeof value !== "object") return null;
  const person = value as Record<string, unknown>;
  if (
    !Number.isInteger(person.id) ||
    Number(person.id) <= 0 ||
    typeof person.name !== "string" ||
    !person.name.trim()
  ) {
    return null;
  }
  return {
    id: Number(person.id),
    name: person.name.trim().slice(0, 200),
  };
};

export const distinctTmdbPeople = (values: unknown[], limit: number) => {
  const people: TmdbPerson[] = [];
  const ids = new Set<number>();
  for (const value of values) {
    const person = parseTmdbPerson(value);
    if (!person || ids.has(person.id)) continue;
    ids.add(person.id);
    people.push(person);
    if (people.length === limit) break;
  }
  return people;
};

export const parseTmdbCredits = (value: unknown): TmdbCredits | null => {
  if (!value || typeof value !== "object") return null;
  const credits = value as Record<string, unknown>;
  if (!Array.isArray(credits.cast) || !Array.isArray(credits.crew)) return null;

  const cast = distinctTmdbPeople(
    credits.cast
      .map((person, index) => ({ person, index }))
      .filter(
        ({ person }) =>
          person !== null &&
          typeof person === "object" &&
          Number.isSafeInteger((person as Record<string, unknown>).order) &&
          Number((person as Record<string, unknown>).order) >= 0,
      )
      .sort((left, right) => {
        const order =
          Number((left.person as Record<string, unknown>).order) -
          Number((right.person as Record<string, unknown>).order);
        return order || left.index - right.index;
      })
      .map(({ person }) => person),
    5,
  );
  const directors = distinctTmdbPeople(
    credits.crew.filter(
      (person) =>
        person !== null &&
        typeof person === "object" &&
        (person as Record<string, unknown>).job === "Director",
    ),
    3,
  );
  return { cast, directors };
};
