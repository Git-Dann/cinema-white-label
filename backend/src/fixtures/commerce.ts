/** Fictional food and drink menu and vouchers for development. */

const sizes = (base: number) => ({
  id: 'size', name: 'Size', min: 1, max: 1,
  options: [{ id: 'regular', name: 'Regular', priceMinor: 0 }, { id: 'large', name: 'Large', priceMinor: Math.round(base * 0.3 / 5) * 5 }],
});
const drinkChoice = { id: 'drink', name: 'Drink', min: 1, max: 1, options: [
  { id: 'cola', name: 'Cola', priceMinor: 0 }, { id: 'diet-cola', name: 'Diet cola', priceMinor: 0 }, { id: 'lemonade', name: 'Sparkling lemonade', priceMinor: 0 }, { id: 'water', name: 'Still water', priceMinor: 0 } ] };

export interface FixtureProduct {
  sku: string; name: string; category: string; priceMinor: number; allergens: string[]; dietary: string[]; calories: number;
  description?: string; stockStatus?: string; bundleItems?: string[]; modifierGroups: unknown[];
  featured?: boolean; badge?: string; compareAtMinor?: number; limitedEdition?: boolean; filmSlug?: string;
}

export const CONCESSIONS: FixtureProduct[] = [
  { sku: 'POP-SWEET', name: 'Sweet popcorn', category: 'Popcorn', priceMinor: 650, allergens: [], dietary: ['Vegan', 'Gluten free'], calories: 520, modifierGroups: [sizes(650)] },
  { sku: 'POP-SALT', name: 'Salted popcorn', category: 'Popcorn', priceMinor: 650, allergens: [], dietary: ['Vegan', 'Gluten free'], calories: 480, modifierGroups: [sizes(650)] },
  { sku: 'POP-MIX', name: 'Sweet & salty popcorn', category: 'Popcorn', priceMinor: 695, allergens: [], dietary: ['Vegan'], calories: 500, modifierGroups: [sizes(695)] },
  { sku: 'NACHOS', name: 'Nachos', category: 'Hot food', priceMinor: 750, allergens: ['Milk'], dietary: ['Vegetarian'], calories: 690, modifierGroups: [
    { id: 'toppings', name: 'Toppings', min: 0, max: 3, options: [{ id: 'cheese', name: 'Extra cheese', priceMinor: 100 }, { id: 'jalapenos', name: 'Jalapeños', priceMinor: 50 }, { id: 'salsa', name: 'Salsa', priceMinor: 0 }, { id: 'sour-cream', name: 'Sour cream', priceMinor: 50 }] },
  ] },
  { sku: 'HOTDOG', name: 'Hot dog', category: 'Hot food', priceMinor: 695, allergens: ['Gluten', 'Mustard'], dietary: [], calories: 430, modifierGroups: [], stockStatus: 'low' },
  { sku: 'DRINK', name: 'Fountain drink', category: 'Drinks', priceMinor: 450, allergens: [], dietary: ['Vegan'], calories: 180, modifierGroups: [sizes(450), drinkChoice] },
  { sku: 'WATER', name: 'Still water 500ml', category: 'Drinks', priceMinor: 300, allergens: [], dietary: ['Vegan'], calories: 0, modifierGroups: [] },
  { sku: 'CHOC', name: 'Chocolate buttons', category: 'Sweets', priceMinor: 350, allergens: ['Milk', 'Soy'], dietary: ['Vegetarian'], calories: 270, modifierGroups: [] },
  { sku: 'ICECREAM', name: 'Vanilla ice cream tub', category: 'Sweets', priceMinor: 425, allergens: ['Milk'], dietary: ['Vegetarian'], calories: 240, modifierGroups: [], stockStatus: 'out' },
  { sku: 'COMBO-DUO', name: 'Date night combo', category: 'Combos', priceMinor: 1595, allergens: [], dietary: ['Vegan'], calories: 1200,
    bundleItems: ['Large popcorn', '2 × regular drinks'], featured: true, compareAtMinor: 1745,
    modifierGroups: [
      { id: 'popcorn', name: 'Popcorn', min: 1, max: 1, options: [{ id: 'sweet', name: 'Sweet', priceMinor: 0 }, { id: 'salted', name: 'Salted', priceMinor: 0 }, { id: 'mix', name: 'Sweet & salty', priceMinor: 50 }] },
      { ...drinkChoice, id: 'drinks', name: 'Drinks', min: 2, max: 2 },
    ] },
];

/**
 * Specials, bundles and film tie-ins. Kept separate so existing databases can be
 * given them once (see ensureFixtureMenuSpecials). `filmSlug` links the product to a film.
 */
export const MENU_SPECIALS: FixtureProduct[] = [
  { sku: 'EMBER-BUCKET', name: 'Ember Protocol collectable bucket', category: 'Merchandise', priceMinor: 1295, allergens: [], dietary: ['Vegan'], calories: 900,
    description: 'A limited run bucket for the film, filled with large popcorn. Keep the bucket.',
    bundleItems: ['Collectable bucket', 'Large popcorn'], featured: true, limitedEdition: true, badge: 'Limited edition', filmSlug: 'ember-protocol',
    modifierGroups: [{ id: 'popcorn', name: 'Popcorn', min: 1, max: 1, options: [{ id: 'sweet', name: 'Sweet', priceMinor: 0 }, { id: 'salted', name: 'Salted', priceMinor: 0 }, { id: 'mix', name: 'Sweet & salty', priceMinor: 0 }] }] },
  { sku: 'TIDE-CARAMEL', name: 'Sea salt caramel popcorn', category: 'Popcorn', priceMinor: 725, allergens: ['Milk'], dietary: ['Vegetarian'], calories: 560,
    description: 'Made for Tidewater: salted caramel with a pinch of sea salt.', featured: true, badge: 'Tidewater special', filmSlug: 'tidewater', modifierGroups: [sizes(725)] },
  { sku: 'HOT-CHOC', name: 'Hot chocolate', category: 'Drinks', priceMinor: 395, allergens: ['Milk'], dietary: ['Vegetarian'], calories: 310,
    description: 'Rich and warming, with optional marshmallows or cream.', featured: true, badge: 'Winter special',
    modifierGroups: [{ id: 'toppings', name: 'Toppings', min: 0, max: 2, options: [{ id: 'marshmallows', name: 'Marshmallows', priceMinor: 50 }, { id: 'cream', name: 'Whipped cream', priceMinor: 50 }] }] },
  { sku: 'COMBO-FAMILY', name: 'Family sharing bundle', category: 'Combos', priceMinor: 2295, allergens: [], dietary: ['Vegan'], calories: 2600,
    description: 'Enough for four: two large popcorns and four drinks.', bundleItems: ['2 × large popcorn', '4 × regular drinks'], featured: true, compareAtMinor: 2790,
    modifierGroups: [{ id: 'popcorn', name: 'Popcorn', min: 1, max: 2, options: [{ id: 'sweet', name: 'Sweet', priceMinor: 0 }, { id: 'salted', name: 'Salted', priceMinor: 0 }, { id: 'mix', name: 'Sweet & salty', priceMinor: 0 }] }] },
];

export const VOUCHERS = [
  { code: 'WELCOME10', description: '10% off your first booking', kind: 'percentOff', value: 10, appliesTo: 'all', minSpendMinor: 0, maxRedemptions: null },
  { code: 'POPCORN2', description: '£2 off food and drink', kind: 'amountOff', value: 200, appliesTo: 'concessions', minSpendMinor: 0, maxRedemptions: null },
  { code: 'LASTONE', description: 'Single-use test code', kind: 'amountOff', value: 500, appliesTo: 'tickets', minSpendMinor: 1000, maxRedemptions: 1 },
];
