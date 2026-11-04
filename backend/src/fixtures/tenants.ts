import type { ThemeId } from '@cinema/contracts';

/** Fictional operators. Names, venues and addresses are invented for development. */

export interface FixtureTenant {
  slug: string;
  name: string;
  wordmark: string;
  logoFont: string;
  /** SVG path (viewBox 0 0 100 100) for the compact brand mark. */
  markPath: string;
  theme: ThemeId;
  availableThemes: ThemeId[];
  palette: { name: string; accent: { light: string; dark: string }; secondary: { light: string; dark: string } };
  extraPalettes: { name: string; accent: { light: string; dark: string }; secondary: { light: string; dark: string } }[];
  support: { email: string; phone: string | null; url: string | null };
  venues: { slug: string; name: string; addressLine1: string; city: string; postcode: string; latitude: number; longitude: number; facilities: string[]; layouts: ('standard' | 'curved' | 'luxe' | 'premiere')[]; features?: Record<string, boolean> }[];
  companionPolicy: 'none' | 'warn' | 'requireWheelchair';
  prices: Record<string, Record<string, number>>;
  formatSupplements: Record<string, number>;
  bookingFeeMinor: number;
}

const ticketPrices = (scale = 1) => {
  const p = (n: number) => Math.round((n * scale) / 5) * 5;
  return {
    ADULT: { standard: p(1250), premium: p(1550), recliner: p(1895), sofa: p(1795), 'luxe-pod': p(2495), 'vip-bed': p(3495) },
    CHILD: { standard: p(899), premium: p(1199), recliner: p(1495), sofa: p(1495), 'luxe-pod': p(1995), 'vip-bed': p(2995) },
    CONCESSION: { standard: p(1050), premium: p(1350), recliner: p(1695), sofa: p(1595), 'luxe-pod': p(2295), 'vip-bed': p(3195) },
  };
};

export const TENANTS: FixtureTenant[] = [
  {
    slug: 'northlight',
    name: 'Northlight Cinemas',
    wordmark: 'Northlight',
    logoFont: 'Space Grotesk',
    markPath: 'M30 70 L30 30 L42 30 L58 56 L58 30 L70 30 L70 70 L58 70 L42 44 L42 70 Z',
    theme: 'midnight',
    availableThemes: ['midnight', 'classic', 'highContrast'],
    palette: { name: 'Northlight Teal', accent: { light: '#0F766E', dark: '#2DD4BF' }, secondary: { light: '#9A6700', dark: '#F5C451' } },
    extraPalettes: [{ name: 'Winter Campaign', accent: { light: '#1D4ED8', dark: '#7DB4FF' }, secondary: { light: '#9A6700', dark: '#F5C451' } }],
    support: { email: 'help@northlight.example', phone: '0113 496 0000', url: 'https://northlight.example/help' },
    venues: [
      { slug: 'leeds-riverside', name: 'Northlight Leeds Riverside', addressLine1: '12 Wharf Approach', city: 'Leeds', postcode: 'LS1 4AB', latitude: 53.7942, longitude: -1.5418, facilities: ['Wheelchair access', 'Hearing loop', 'Bar', 'Parking nearby', 'Seat delivery'], layouts: ['standard', 'curved', 'luxe', 'premiere'], features: { seatDelivery: true } },
      { slug: 'manchester-ancoats', name: 'Northlight Manchester Ancoats', addressLine1: '3 Mill Yard', city: 'Manchester', postcode: 'M4 6DE', latitude: 53.4851, longitude: -2.2276, facilities: ['Wheelchair access', 'Hearing loop', 'IMAX', 'Bar'], layouts: ['curved', 'standard', 'luxe'] },
      { slug: 'york-walls', name: 'Northlight York Walls', addressLine1: '48 Bar Lane', city: 'York', postcode: 'YO1 6JX', latitude: 53.958, longitude: -1.0873, facilities: ['Wheelchair access', 'Hearing loop'], layouts: ['standard', 'luxe'], features: { concessions: false } },
      { slug: 'sheffield-kelham', name: 'Northlight Sheffield Kelham', addressLine1: '7 Forge Street', city: 'Sheffield', postcode: 'S3 8RL', latitude: 53.3893, longitude: -1.4713, facilities: ['Wheelchair access', 'Audio description', 'Café'], layouts: ['standard', 'curved'] },
    ],
    prices: ticketPrices(1),
    formatSupplements: { IMAX: 400, '3D': 200, 'Dolby Atmos': 250 },
    bookingFeeMinor: 95,
    companionPolicy: 'warn',
  },
  {
    slug: 'kestrel',
    name: 'Kestrel Picturehouse',
    wordmark: 'Kestrel',
    logoFont: 'Playfair Display',
    markPath: 'M28 66 L50 28 L72 66 L62 66 L50 46 L38 66 Z',
    theme: 'classic',
    availableThemes: ['classic', 'premium', 'light', 'highContrast'],
    palette: { name: 'Kestrel Red', accent: { light: '#B0102A', dark: '#FF5A6A' }, secondary: { light: '#8A6A12', dark: '#D4AF37' } },
    extraPalettes: [],
    support: { email: 'boxoffice@kestrel.example', phone: null, url: 'https://kestrel.example/contact' },
    venues: [
      { slug: 'bath-abbey-green', name: 'Kestrel Bath', addressLine1: '2 Abbey Mews', city: 'Bath', postcode: 'BA1 1LT', latitude: 51.3811, longitude: -2.359, facilities: ['Wheelchair access', 'Bar', 'Hearing loop'], layouts: ['luxe', 'standard', 'premiere'] },
      { slug: 'brighton-lanes', name: 'Kestrel Brighton', addressLine1: '19 Pavilion Row', city: 'Brighton', postcode: 'BN1 1EE', latitude: 50.8225, longitude: -0.1372, facilities: ['Wheelchair access', 'Café'], layouts: ['standard', 'curved'] },
    ],
    prices: ticketPrices(1.08),
    formatSupplements: { IMAX: 450, '3D': 250, 'Dolby Atmos': 300 },
    bookingFeeMinor: 0,
    companionPolicy: 'requireWheelchair',
  },
];
