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
      className={cn(
        "poster-fallback grid aspect-[2/3] w-full place-items-center rounded-2xl border border-white/10 p-5 text-center",
        sizeClass,
      )}
    >
      <Clapperboard className="text-lime-300/60" size={large ? 34 : 20} />
      <span className="mt-3 text-xs font-semibold text-zinc-500">{title}</span>
    </div>
  );
}
