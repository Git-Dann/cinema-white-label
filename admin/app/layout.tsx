import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

// Self-hosted at build time by next/font: no runtime request to Google.
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

// Icons and share images come from the files beside this one (icon.svg, apple-icon.png,
// opengraph-image.jpg, twitter-image.jpg). The portal sits behind a login, so it stays out of search.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://admin.seatfold.uk'),
  title: { default: 'Seatfold operator portal', template: '%s · Seatfold' },
  description: 'Brand, prices, menus and planning for every cinema.',
  applicationName: 'Seatfold',
  openGraph: { type: 'website', siteName: 'Seatfold', title: 'Seatfold operator portal', description: 'Brand, prices, menus and planning for every cinema.', locale: 'en_GB' },
  twitter: { card: 'summary_large_image', title: 'Seatfold operator portal', description: 'Brand, prices, menus and planning for every cinema.' },
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: '#0b0d10' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${geist.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
