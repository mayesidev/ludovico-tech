import type { AnchorHTMLAttributes, MouseEvent } from "react";

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
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

  return <a href={href} onClick={handleClick} {...props} />;
}
