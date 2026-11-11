import { adviceCategory, adviceLevel, buildFilmDetails, certificateMeaning, contentAdvice, personInfo, readDetails, shortBio } from './film-details';
import { pickLogo } from './tmdb-demo';

describe('film details', () => {
  it('keeps two sentences of a biography and never cuts a word', () => {
    expect(shortBio('One. Two! Three?')).toBe('One. Two!');
    expect(shortBio('')).toBeNull();
    const long = shortBio('word '.repeat(100) + '.');
    expect(long!.length).toBeLessThanOrEqual(281);
    expect(long!.endsWith('word…')).toBe(true);
  });

  it('groups BBFC advice by category with the strongest level', () => {
    const m = { release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [{ descriptors: ['mild violence', 'Strong bloody violence', 'infrequent strong language', 'drug misuse'] }] }] } };
    expect(contentAdvice(m)).toEqual([
      { category: 'Violence', level: 'Strong', text: 'strong bloody violence' },
      { category: 'Language', level: 'Strong', text: 'infrequent strong language' },
      { category: 'Alcohol & drugs', level: 'Contains', text: 'drug misuse' },
    ]);
    expect(contentAdvice({})).toEqual([]);
    expect(adviceCategory('horror')).toBe('Frightening & intense');
    expect(adviceCategory('flashing images')).toBe('Flashing images');
    expect(adviceLevel('moderate sex references')).toBe('Moderate');
  });

  it('orders cast by billing, keeps key crew once each, and reads old rows safely', () => {
    const d = buildFilmDetails(
      {
        credits: {
          cast: [{ id: 2, name: 'B', order: 1 }, { id: 1, name: 'A', character: 'Lead', order: 0 }],
          crew: [{ job: 'Director', name: 'D' }, { job: 'Director', name: 'D' }, { job: 'Grip', name: 'G' }, { job: 'Producer', name: 'P1' }, { job: 'Producer', name: 'P2' }, { job: 'Producer', name: 'P3' }],
        },
        original_title: 'Same', title: 'Same', budget: 0,
      },
      new Map([[1, { biography: 'Bio A.', fullBiography: 'Bio A. More.', birthday: '1970-01-02', deathday: null, placeOfBirth: 'Leeds' }]]),
    );
    expect(d.cast.map((c) => [c.name, c.character, c.biography, c.birthday])).toEqual([['A', 'Lead', 'Bio A.', '1970-01-02'], ['B', null, null, undefined]]);
    expect(d.crew).toEqual([{ name: 'D', job: 'Director' }, { name: 'P1', job: 'Producer' }, { name: 'P2', job: 'Producer' }]);
    expect(d.about).toMatchObject({ originalTitle: null, budget: null });
    expect(readDetails({})).toEqual({ cast: [], crew: [], about: null, advice: [] });
    expect(readDetails(null).cast).toEqual([]);
  });

  it('explains UK certificates and picks an English logo first', () => {
    expect(certificateMeaning('12A')).toBe('12 and over, or with an adult');
    expect(certificateMeaning('TBC')).toBeNull();
    expect(pickLogo([{ file_path: '/x.png', iso_639_1: null, vote_average: 9 }, { file_path: '/e.png', iso_639_1: 'en', vote_average: 1 }])!.file_path).toBe('/e.png');
    expect(pickLogo([{ file_path: '/d.png', iso_639_1: 'de' }])).toBeNull();
  });

  it('keeps a person\'s full biography, dates and birthplace, and drops malformed dates', () => {
    const p = personInfo({ biography: 'First. Second. Third.', birthday: '1969-11-10', deathday: '', place_of_birth: 'Everett, Massachusetts' });
    expect(p).toEqual({ biography: 'First. Second.', fullBiography: 'First. Second. Third.', birthday: '1969-11-10', deathday: null, placeOfBirth: 'Everett, Massachusetts' });
    expect(personInfo({ birthday: '1969' }).birthday).toBeNull();
    expect(personInfo({}).fullBiography).toBeNull();
  });
});
