import { ImageOff } from "lucide-react";
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
  const sizeClass = large ? "max-w-[340px]" : "max-w-[90px]";
  const posterClassName = cn(
    "aspect-[2/3] w-full object-cover",
    large
      ? "border border-canvas/80"
      : "border border-highlight/20 shadow-lg shadow-black/35",
  );

  if (src) {
    const poster = (
      <img src={src} alt={`Poster for ${title}`} className={posterClassName} />
    );
    return large ? (
      <div className={cn("poster-frame w-full", sizeClass)}>{poster}</div>
    ) : (
      <div className={cn("w-full", sizeClass)}>{poster}</div>
    );
  }

  const fallback = (
    <div
      aria-label={`No poster available for ${title}`}
      className={cn(
        "poster-fallback grid aspect-[2/3] w-full place-items-center p-5 text-center",
        !large && "border border-highlight/20",
      )}
      role="img"
    >
      <ImageOff className="text-highlight/70" size={large ? 34 : 20} />
    </div>
  );

  return large ? (
    <div className={cn("poster-frame w-full", sizeClass)}>{fallback}</div>
  ) : (
    <div className={cn("w-full", sizeClass)}>{fallback}</div>
  );
}
