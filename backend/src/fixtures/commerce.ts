/** Fictional food and drink menu and vouchers for development. */

const sizes = (base: number) => ({
  id: 'size', name: 'Size', min: 1, max: 1,
  options: [{ id: 'regular', name: 'Regular', priceMinor: 0 }, { id: 'large', name: 'Large', priceMinor: Math.round(base * 0.3 / 5) * 5 }],
});
const drinkChoice = { id: 'drink', name: 'Drink', min: 1, max: 1, options: [
  { id: 'cola', name: 'Cola', priceMinor: 0 }, { id: 'diet-cola', name: 'Diet cola', priceMinor: 0 }, { id: 'lemonade', name: 'Sparkling lemonade', priceMinor: 0 }, { id: 'water', name: 'Still water', priceMinor: 0 } ] };

export const CONCESSIONS = [
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
    bundleItems: ['Large popcorn', '2 × regular drinks'],
    modifierGroups: [
      { id: 'popcorn', name: 'Popcorn', min: 1, max: 1, options: [{ id: 'sweet', name: 'Sweet', priceMinor: 0 }, { id: 'salted', name: 'Salted', priceMinor: 0 }, { id: 'mix', name: 'Sweet & salty', priceMinor: 50 }] },
      { ...drinkChoice, id: 'drinks', name: 'Drinks', min: 2, max: 2 },
    ] },
];

export const VOUCHERS = [
  { code: 'WELCOME10', description: '10% off your first booking', kind: 'percentOff', value: 10, appliesTo: 'all', minSpendMinor: 0, maxRedemptions: null },
  { code: 'POPCORN2', description: '£2 off food and drink', kind: 'amountOff', value: 200, appliesTo: 'concessions', minSpendMinor: 0, maxRedemptions: null },
  { code: 'LASTONE', description: 'Single-use test code', kind: 'amountOff', value: 500, appliesTo: 'tickets', minSpendMinor: 1000, maxRedemptions: 1 },
];
