/**
 * Small line icons for the menu, drawn on a 20px grid with the current text colour.
 * Inline SVG so there's no icon dependency (docs/decisions/0001-dependencies.md).
 */
const PATHS = {
  home: 'M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1H12v-5H8v5H4.5a1 1 0 0 1-1-1z',
  today: 'M4 5h12v11H4zM4 8.5h12M7.5 3v3M12.5 3v3M8 12h4',
  calendar: 'M4 5h12v11H4zM4 8.5h12M7.5 3v3M12.5 3v3M7 11.5h2M11 11.5h2M7 14h2',
  chart: 'M4 16V9M8 16V5M12 16v-6M16 16V7M3 16.5h14',
  spark: 'M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z',
  film: 'M4 4h12v12H4zM7 4v12M13 4v12M4 7.5h3M4 12.5h3M13 7.5h3M13 12.5h3',
  building: 'M4 16.5V5.5L10 3l6 2.5v11M2.5 16.5h15M8 16.5v-4h4v4M7 8h1.5M11.5 8H13M7 11h1.5M11.5 11H13',
  screen: 'M3 4.5h14v9H3zM7 16.5h6M10 13.5v3',
  seat: 'M6 4.5h8a1 1 0 0 1 1 1V10H5V5.5a1 1 0 0 1 1-1zM4 10h12v3H4zM5.5 13v3M14.5 13v3',
  food: 'M6 7h8l-1 9.5H7zM6.5 7 5.5 4M10 4.5c1.4 0 2.5 1.1 2.5 2.5h-5c0-1.4 1.1-2.5 2.5-2.5z',
  megaphone: 'M4 8.5v3l9 4V4.5zM13 7.5h1.5a2.5 2.5 0 0 1 0 5H13M6 11.5l1 4h2l-1-3.6',
  ticket: 'M3.5 6.5h13v2a1.5 1.5 0 0 0 0 3v2h-13v-2a1.5 1.5 0 0 0 0-3zM12 6.5v7',
  star: 'M10 3.5l2 4.2 4.5.6-3.3 3.1.9 4.5L10 13.7l-4.1 2.2.9-4.5-3.3-3.1 4.5-.6z',
  palette: 'M10 3.5a6.5 6.5 0 1 0 0 13c1 0 1.5-.6 1.5-1.4 0-1.1-.9-1.4-.9-2.3 0-.8.6-1.3 1.4-1.3h1.6a2.9 2.9 0 0 0 2.9-2.9c0-2.9-2.9-5.1-6.5-5.1zM6.5 10h.01M8 6.8h.01M11.5 6.5h.01',
  layers: 'M10 3.5 17 7l-7 3.5L3 7zM3 10.5l7 3.5 7-3.5M3 13.5l7 3.5 7-3.5',
  plug: 'M7.5 3v4M12.5 3v4M5.5 7h9v2.5a4.5 4.5 0 0 1-9 0zM10 14v3',
  people: 'M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2.5 16c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5M13 4.2a2.5 2.5 0 0 1 0 4.6M14.5 11.8c1.8.5 3 1.9 3 4.2',
  pulse: 'M2.5 10.5h3.2l1.8-4.5 3 9 2.2-6 1.3 1.5h3.5',
  chevron: 'M7 8l3 3 3-3',
  updown: 'M7 8l3-3 3 3M7 12l3 3 3-3',
  signout: 'M11.5 4H5v12h6.5M9 10h8M14 7l3 3-3 3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
