import type { JSX } from 'react';

/**
 * Small decorative line icons (24 px grid, `currentColor`), always
 * aria-hidden: the text next to them carries the meaning.
 */
export type IconName =
  'mail' | 'check' | 'alert' | 'alert-circle' | 'close' | 'search' | 'music' | 'shield' | 'compass';

const PATHS: Readonly<Record<IconName, JSX.Element>> = {
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4.5M12 17.25v.01" />
    </>
  ),
  // The same circled "!" as the MCP View's notices.
  'alert-circle': (
    <>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M12 7.25v5.5M12 16.5v.01" />
    </>
  ),
  close: <path d="m7 7 10 10M17 7 7 17" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5.5l11-2V16" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6l-7-3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
};

export function Icon(props: { name: IconName; className?: string }): JSX.Element {
  return (
    <svg
      className={props.className ?? 'app-icon'}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[props.name]}
    </svg>
  );
}
