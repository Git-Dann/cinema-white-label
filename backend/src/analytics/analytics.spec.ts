import { sanitiseProperties } from './analytics.module';

describe('analytics schema', () => {
  it('keeps declared properties and drops everything else', () => {
    expect(sanitiseProperties('food_added', { productId: 'p1', quantity: '2', email: 'a@b.c', latitude: 53.8 })).toEqual({ productId: 'p1', quantity: 2 });
  });
  it('drops invalid values', () => {
    expect(sanitiseProperties('film_impression', { filmId: 'f', list: 'home', position: -1 })).toEqual({ filmId: 'f', list: 'home' });
  });
});
