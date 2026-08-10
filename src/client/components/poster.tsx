import { Clapperboard } from "lucide-react";
import { cn, posterUrl } from "../lib/utils";

export function Poster({
  path,
  title,
  large = false,
}: {
  path: string | null | undefined;
  title: string;
  large?: boolean;
}) {
  const src = posterUrl(path);
  const sizeClass = large ? "max-w-[220px]" : "max-w-[90px]";

  if (src) {
    return (
      <img
        src={src}
        alt={`Poster for ${title}`}
        className={cn(
          "aspect-[2/3] w-full rounded-2xl object-cover shadow-2xl shadow-black/40",
          sizeClass,
        )}
      />
    );
  }

  return (
    <div
      aria-label={`No poster available for ${title}`}
      className={cn(
        "poster-fallback grid aspect-[2/3] w-full place-items-center rounded-2xl border border-marquee-gold/15 p-5 text-center",
        sizeClass,
      )}
      role="img"
    >
      <Clapperboard className="text-marquee-gold/70" size={large ? 34 : 20} />
    </div>
  );
}
