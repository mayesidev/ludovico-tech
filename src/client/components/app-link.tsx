import type { ComponentProps, MouseEvent } from "react";
import { Link } from "./ui/link";

type AppLinkProps = ComponentProps<typeof Link> & {
  onNavigate: (path: string) => void;
};

export function AppLink({ href, onClick, onNavigate, ...props }: AppLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    onNavigate(href);
  };

  return <Link href={href} onClick={handleClick} {...props} />;
}
