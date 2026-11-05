"use strict";
/**
 * Original, fictional films for development. None of these titles, synopses
 * or artworks refer to real productions. Artwork is generated locally by
 * shared/fixtures/generate-artwork.js from the `art` parameters below.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILMS = void 0;
exports.FILMS = [
    {
        slug: 'the-lantern-keeper', title: 'The Lantern Keeper', tagline: 'Every light remembers who lit it.',
        synopsis: 'On a storm-cut island off the Hebrides, a reclusive keeper discovers that the old lighthouse lamp shows ships that sank a century ago. When a young coastguard arrives to decommission the tower, the two must decide which lights deserve to stay burning.',
        releaseOffsetDays: -12, runtimeMinutes: 128, certificate: '12A', genres: ['Drama', 'Fantasy'], director: 'Isla Mackenzie', cast: ['Rhona Byrne', 'Tomasz Wilk', 'Ade Okafor'],
        formats: [['2D'], ['2D', 'Audio Described']],
        art: { sky: ['#0B1D3A', '#27496D', '#E3A35B'], ground: '#06101F', orb: '#FFE7B0', motif: 'lighthouse', font: 'Playfair Display', titleColor: '#FFF4DE', titlePosition: 'bottom' },
    },
    {
        slug: 'signal-lost', title: 'Signal Lost', tagline: 'Somebody answered.',
        synopsis: 'A radio astronomer in the Cairngorms picks up a repeating signal that seems to predict events forty minutes before they happen. As the predictions turn personal, she has less than an hour to work out who is broadcasting, and why.',
        releaseOffsetDays: -5, runtimeMinutes: 117, certificate: '15', genres: ['Sci-Fi', 'Thriller'], director: 'Daniel Ferreira', cast: ['Mara Lindqvist', 'Jonah Pryce'],
        formats: [['2D'], ['IMAX']],
        art: { sky: ['#020611', '#0B2340', '#1B5E7A'], ground: '#010309', orb: '#9EF0FF', motif: 'mountains', font: 'Space Grotesk', titleColor: '#D8FBFF', titlePosition: 'top' },
    },
    {
        slug: 'harbour-lights', title: 'Harbour Lights', tagline: 'Some summers never leave port.',
        synopsis: 'Two former sweethearts return to their Cornish fishing town to sell the family boatyard, only to find the town has other plans for them both.',
        releaseOffsetDays: -20, runtimeMinutes: 104, certificate: '12A', genres: ['Romance', 'Drama'], director: 'Priya Natarajan', cast: ['Elodie Marsh', 'Kit Adeyemi'],
        formats: [['2D']],
        art: { sky: ['#F7B48A', '#F28C7A', '#5A4E7C'], ground: '#2A2140', orb: '#FFF1C9', motif: 'sea', font: 'Cormorant Garamond', titleColor: '#FFF8EE', titlePosition: 'top' },
    },
    {
        slug: 'paper-comets', title: 'Paper Comets', tagline: 'Fold a wish. Watch it fly.',
        synopsis: 'When eleven-year-old Juno folds a paper comet that actually takes off, she and her grandfather chase it across a city where every lost wish has quietly been collected.',
        releaseOffsetDays: -9, runtimeMinutes: 94, certificate: 'U', genres: ['Animation', 'Family'], director: 'Leo Hartmann', cast: ['Amara Quinn', 'Bill Ashdown'],
        formats: [['2D'], ['3D'], ['2D', 'Relaxed']],
        art: { sky: ['#2B1B5A', '#6A3FB5', '#FF8FB1'], ground: '#1A1238', orb: '#FFD86B', motif: 'city', font: 'Archivo Black', titleColor: '#FFF6D6', titlePosition: 'top' },
    },
    {
        slug: 'northbound', title: 'Northbound', tagline: '600 miles. One night. No stops.',
        synopsis: 'A retired getaway driver agrees to one last overnight run from London to Thurso, carrying a passenger who has every reason not to arrive.',
        releaseOffsetDays: -3, runtimeMinutes: 132, certificate: '15', genres: ['Action', 'Crime'], director: 'Marcus Hale', cast: ['Declan Shore', 'Yuki Tanabe', 'Ruth Calder'],
        formats: [['2D'], ['IMAX'], ['Dolby Atmos']],
        art: { sky: ['#140A05', '#5C1F0B', '#E2571E'], ground: '#0A0503', orb: '#FFC08A', motif: 'road', font: 'Bebas Neue', titleColor: '#FFE3CC', titlePosition: 'bottom' },
    },
    {
        slug: 'the-quiet-orchard', title: 'The Quiet Orchard', tagline: 'The trees saw everything.',
        synopsis: 'A forensic botanist is called to a Herefordshire orchard where the apples have stopped falling. Beneath the roots lies a thirty-year-old secret the village would rather keep buried.',
        releaseOffsetDays: -15, runtimeMinutes: 111, certificate: '12A', genres: ['Mystery', 'Drama'], director: 'Hannah Okoro', cast: ['Celia Dunmore', 'Ravi Patel'],
        formats: [['2D'], ['2D', 'Subtitled']],
        art: { sky: ['#C9D6B8', '#7E9A6B', '#2F4A2C'], ground: '#142212', orb: '#F4F0D9', motif: 'forest', font: 'Playfair Display', titleColor: '#F8F5E6', titlePosition: 'top' },
    },
    {
        slug: 'velvet-static', title: 'Velvet Static', tagline: 'Turn it up. Let it break.',
        synopsis: 'A Sheffield synth band on the edge of a record deal discovers their late bandmate left one unreleased song, and it is about all of them.',
        releaseOffsetDays: -7, runtimeMinutes: 121, certificate: '15', genres: ['Music', 'Drama'], director: 'Sasha Novak', cast: ['Billie Crane', 'Omar Siddiqui', 'Fen Albright'],
        formats: [['2D'], ['Dolby Atmos']],
        art: { sky: ['#12001F', '#5B0E6B', '#FF3D7F'], ground: '#0A0012', orb: '#FFB3D1', motif: 'city', font: 'Oswald', titleColor: '#FFE1F0', titlePosition: 'bottom' },
    },
    {
        slug: 'tidewater', title: 'Tidewater', tagline: 'The sea always takes something back.',
        synopsis: 'Trapped by a spring tide on a causeway island, six strangers have until low water to find out which of them caused the crash that stranded them.',
        releaseOffsetDays: -2, runtimeMinutes: 108, certificate: '15', genres: ['Thriller'], director: 'Owen Rees', cast: ['Nadia Kowalski', 'Gareth Lloyd'],
        formats: [['2D']],
        art: { sky: ['#0E1A22', '#30505E', '#8FB3B8'], ground: '#071015', orb: '#E6F2F2', motif: 'sea', font: 'Bebas Neue', titleColor: '#EAF6F6', titlePosition: 'top' },
    },
    {
        slug: 'copper-and-clay', title: 'Copper & Clay', tagline: 'A very civil war.',
        synopsis: 'Rival pottery shops on the same Stoke high street declare war when a television competition comes to town. Nobody expected the kiln to explode.',
        releaseOffsetDays: -25, runtimeMinutes: 99, certificate: 'PG', genres: ['Comedy'], director: 'Grace Whitfield', cast: ['Toby Marsden', 'Leena Shah'],
        formats: [['2D']],
        art: { sky: ['#F5D9B8', '#E7A06A', '#B5562D'], ground: '#5A2615', orb: '#FFF3E0', motif: 'desert', font: 'Archivo Black', titleColor: '#3A170B', titlePosition: 'top' },
    },
    {
        slug: 'ember-protocol', title: 'Ember Protocol', tagline: 'Humanity gets one restart.',
        synopsis: 'When the orbital array that cools the planet begins to fail, a disgraced engineer must lead a skeleton crew to restart it from the inside.',
        releaseOffsetDays: -1, runtimeMinutes: 141, certificate: '12A', genres: ['Sci-Fi', 'Action'], director: 'Felix Ambrose', cast: ['Sienna Holt', 'Kwame Mensah', 'Ingrid Sol'],
        formats: [['2D'], ['IMAX'], ['3D'], ['Dolby Atmos']],
        art: { sky: ['#05010A', '#2A0B1E', '#C2410C'], ground: '#030006', orb: '#FF9F43', motif: 'planet', font: 'Space Grotesk', titleColor: '#FFE8D1', titlePosition: 'bottom' },
    },
    {
        slug: 'saltmarsh', title: 'Saltmarsh', tagline: 'Do not follow the lights.',
        synopsis: 'A sound recordist cataloguing birdsong on the Essex marshes captures something on tape that should not be able to breathe underwater.',
        releaseOffsetDays: 9, runtimeMinutes: 96, certificate: '18', genres: ['Horror'], director: 'Ruth Abernathy', cast: ['Josie Kerr', 'Malik Ibrahim'],
        formats: [['2D']],
        art: { sky: ['#0A0F0A', '#1E2B1C', '#56664A'], ground: '#030503', orb: '#D9E8C5', motif: 'forest', font: 'Cormorant Garamond', titleColor: '#E4EFD6', titlePosition: 'bottom' },
    },
    {
        slug: 'glasshouse-summer', title: 'Glasshouse Summer', tagline: 'Everything grows. Even us.',
        synopsis: 'Three teenagers volunteer at a crumbling Victorian glasshouse in Kew and spend a summer trying to save it, and each other.',
        releaseOffsetDays: 16, runtimeMinutes: 102, certificate: '12A', genres: ['Drama', 'Coming of Age'], director: 'Ana Ribeiro', cast: ['Pip Morley', 'Sami Haddad', 'Ellie Tran'],
        formats: [['2D']],
        art: { sky: ['#E8F6EF', '#9ED8C0', '#3E8E7E'], ground: '#1C4A40', orb: '#FFFBEA', motif: 'forest', font: 'Oswald', titleColor: '#0F2E28', titlePosition: 'top' },
    },
    {
        slug: 'the-last-cartographer', title: 'The Last Cartographer', tagline: 'Some places refuse to be found.',
        synopsis: 'An elderly mapmaker and her impatient grandson set out to chart the one valley in Wales that has never appeared on any map.',
        releaseOffsetDays: 23, runtimeMinutes: 125, certificate: 'PG', genres: ['Adventure', 'Family'], director: 'Huw Bevan', cast: ['Margaret Lyle', 'Cai Roberts'],
        formats: [['2D'], ['IMAX']],
        art: { sky: ['#FCE7C8', '#E9B87A', '#7A5230'], ground: '#3B2615', orb: '#FFF7E8', motif: 'mountains', font: 'Cormorant Garamond', titleColor: '#2C1A0B', titlePosition: 'top' },
    },
    {
        slug: 'midnight-ferry', title: 'Midnight Ferry', tagline: 'Last crossing. No return.',
        synopsis: 'On the final overnight sailing from Liverpool to Belfast before the route closes, an off-duty detective realises one passenger boarded who never bought a ticket.',
        releaseOffsetDays: 30, runtimeMinutes: 113, certificate: '15', genres: ['Crime', 'Mystery'], director: 'Siobhan Kerrigan', cast: ['Aidan Cole', 'Lena Varga'],
        formats: [['2D']],
        art: { sky: ['#03040A', '#101A33', '#2C3E66'], ground: '#010205', orb: '#E8EEFF', motif: 'sea', font: 'Bebas Neue', titleColor: '#E8EEFF', titlePosition: 'top' },
    },
];
//# sourceMappingURL=films.js.map