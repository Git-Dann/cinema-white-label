# Seatfold Pulse: data sources, licences and evidence

Research date: 11 November 2026. Scope: free sources only, commercial use (operators pay us), UK first, no scraping where terms forbid it, every figure attributable, model stays explainable.

How to read this document:

- "Verified" means we opened the primary page (terms, licence or docs) during this research and the quote or figure comes from it.
- "Not verified" means we could not open the primary page (blocked, 404, rate limited) and the statement comes from search summaries or memory. These are listed again in "Open questions and risks".
- Nothing here is legal advice. Anything marked "ask" needs a written answer from the publisher before production use.

Derived numbers live in `shared/fixtures/pulse/priors.json`. No raw third-party data is committed.

## 1. Summary table

| Source | What | Licence / commercial OK? | Cost | Cadence | Pulse use | Verdict |
|---|---|---|---|---|---|---|
| gov.uk bank holidays JSON | E&W, Scotland, NI bank holidays 2019 to 2028 | OGL v3.0 via GOV.UK terms. Yes, with attribution | Free | Updated as announced | Holiday multiplier (already integrated) | Use now |
| School term dates (council open data) | Term and holiday dates per local authority | Varies by council, mostly OGL. Mostly yes | Free | Yearly | School holiday multiplier, family slots, staffing | Use now (curated per venue) |
| Clock changes, sunset | Computed from IANA tz database and solar position formula | tz database is public domain. Yes | Free | Static | Evening slot multiplier, "dark by 5pm" effect | Use now |
| Wikimedia pageviews API | Daily views per Wikipedia article since July 2015 | CC0 (verified). Yes | Free, needs User-Agent | Daily | Pre-release hype signal, film multiplier | Use now |
| Wikidata | Film entities: series, follows/followed by, genre, release dates by country, box office | Structured data CC0 (verified). Yes | Free | Continuous | Franchise and sequel flags, genre, UK release date cross-check | Use now (cache, see rate limits) |
| BFI Statistical Yearbook tables | Monthly UK admissions, top films with opening and total gross, regional admissions per head, genre, release width | BFI copyright, no open licence; site terms say personal and non-commercial. Ask | Free to read | Yearly (latest: 2024 edition, 2023 data) | National priors: seasonality, film legs, catchment, release width | Use now as internal priors, ask BFI before showing to operators |
| BFI weekend box office reports | Weekly UK and Ireland top 15 plus UK and new releases: gross, % change, weeks, sites, site average, previews notes, next week's openers | Same BFI terms; data from Comscore; `core-cms.bfi.org.uk/robots.txt` disallows all crawlers. Not without permission | Free to read | Weekly (Mon/Tue) | Would calibrate UK decay curves and "openers next week" competition signal | Later, only with written BFI permission |
| UK Cinema Association monthly admissions | Monthly UK admissions | Not verified (page would not load for our tools) | Free to read | Monthly | Cross-check of seasonality | Later (ask UKCA) |
| Comscore | Theatrical box office census | Paid licence | Paid | Daily | Market share benchmarking | Note only |
| Box Office Mojo (IMDb) | US and international grosses | IMDb conditions forbid robots and commercial exploitation (verified) | Paid licence route | Daily | None | Avoid |
| The Numbers | US and international grosses | Terms page returned 404; owner sells OpusData subscriptions. Not verified | Paid | Daily | None | Avoid |
| IMDb non-commercial datasets | Titles, crew, ratings and vote counts | "Personal and non-commercial use" (verified) | Free (non-commercial) / paid licence | Daily | None without a commercial licence | Avoid |
| OMDb | IMDb-like metadata | Terms: personal use only, "You may not build a business" on it (verified) | Free / Patreon | n/a | None | Avoid |
| TMDB API (existing integration) | Films, popularity, votes, UK certificates, release dates by country and type | Free licence "does not permit any commercial use"; ML/AI use prohibited; cache max 6 months (verified). Commercial needs a written agreement | Commercial price unpublished | Daily | Film prior (popularity, votes, release type) | Use only after a commercial agreement; block Pulse features on it until then |
| Google Trends API | Search interest, 5-year window | Alpha, allowlisted testers only; no commercial terms published (verified) | n/a | Daily | Hype signal | Avoid for now |
| YouTube Data API | Trailer views | Non-authorised stats may not be stored over 30 days; no derived metrics (verified) | Free quota | Live | Trailer hype | Avoid |
| Letterboxd API | Social film data | Private API (docs 403) | n/a | n/a | None | Avoid |
| MovieLens | Ratings datasets | README not reachable (503); GroupLens says check README and "typically" no redistribution. Not verified; historically research use only | Free | Occasional | None | Avoid |
| Met Office Weather DataHub | Site-specific forecasts (Global spot, Blended probabilistic) | Licence to use in "Your Application", business use allowed, attribution "Data supplied by the Met Office", no redistribution in original form (verified, terms v13) | Free: 360 calls/day (Global spot), 55/day (Blended probabilistic); paid from GBP 9/month | Hourly | Live weather adjustment | Later (after backtest shows an effect) |
| Met Office MIDAS Open (CEDA) | Historical UK station observations | OGL (search-verified on CEDA records) | Free, registration | Yearly releases | Backtest whether weather matters per venue | Later (first weather step) |
| ERA5 (Copernicus CDS) | Gridded historical weather reanalysis | CC BY 4.0 since 2 July 2025 per ECMWF forum (search-verified). Yes | Free | Daily, ~5 days lag | Backtest alternative to MIDAS | Later |
| Open-Meteo | Forecast and historical weather API | Free tier non-commercial only (verified). Data CC BY 4.0; UK Met Office model data CC BY-SA 4.0 | Paid tiers for commercial; historical needs Professional | Hourly | Weather | Avoid free tier; paid is an option |
| ONS Census 2021 / Nomis | Population by age, households, cars, etc. by area | OGL v3.0 (ONS licences page verified; Nomis terms page 404) | Free | Decennial | Catchment prior | Later |
| ONS Postcode Directory / postcodes.io | Postcode to LSOA, LA, coordinates | OGL plus OS and Royal Mail attribution; Northern Ireland (BT) postcodes need a Land and Property Services licence for commercial use (verified) | Free | Quarterly | Map loyalty members and venues to areas | Later (careful with NI) |
| English Indices of Deprivation 2025 | LSOA deprivation ranks | GOV.UK publication, OGL by default (not separately verified) | Free | About every 5 years | Catchment and price sensitivity prior | Later |
| openfootball (football.json) | League fixtures incl. Premier League, EFL, 2010-11 to 2026-27 | CC0 (verified); dates but apparently no kick-off times | Free | Daily auto-update | Big-match competition flag | Later |
| football-data.org | Fixtures with times, 12 competitions free | Commercial use on free tier not stated | Free / EUR 12 to 199 a month | Live | Kick-off times | Later (ask) |
| Ticketmaster Discovery API | Local events | Terms bar selling or sublicensing the API; caching only "for reasonable periods" (verified) | Free key | Live | Local event competition | Later (ask) |
| Skiddle API | UK events | "Non-commercial use only" without written approval (verified) | Free key | Live | Local events | Later (ask) |
| Eventbrite | Event search | Public search endpoint shut down 12 December 2019 (verified) | n/a | n/a | None | Avoid |

## 2. Sources in detail

### 2.1 Box office and market statistics

#### BFI Statistical Yearbook (data tables)

- What: annual chapters with ODS data tables. The 2024 edition (2023 data) is the latest on the page. Useful tables we opened:
  - "The UK box office in 2023", Table 2: monthly UK admissions (millions) 2019 to 2023, source "CAA, Comscore".
  - Same file, Table 6: releases and median gross by sites at widest point of release (corrected 3 July 2026).
  - "Top films in 2023", Tables 1 to 3: title, country, total gross, widest release (sites), opening weekend gross, distributor; Table 9: releases and gross by genre; Table 10: by BBFC certificate.
  - "Exhibition", Table 1: screens, sites, population, admissions, admissions per head and average ticket price by ISBA TV region.
  - "Audiences", Figure 1: age distribution of cinemagoers 2019 to 2023 (CAA Film Monitor).
- History: yearbooks back to 2014 on the page, archive beyond.
- Access: direct ODS/XLSX/PDF downloads, no key.
- Licence: the yearbook page shows only "© British Film Institute. All rights reserved." The BFI terms of use (clause 2.2) say "The Site is for your personal and non-commercial use" and forbid selling information obtained from it "unless expressly authorised by us". Other BFI publications (annual reports) carry an OGL-style reuse notice, but we did not find one on the yearbook. Underlying data is Comscore and CAA.
- Our position: we read five tables by hand and derived aggregate priors (ratios, shares, medians). We cite the source on every value and mark them `quote-with-attribution`. Before we show these numbers to operators or ship them as defaults, email the BFI Research and Statistics Unit for written confirmation.
- Reliability: official statistics producer under the Statistics and Registration Services Act 2007; very stable.
- Pulse use: seasonality month index, film legs prior, release width prior, regional catchment prior, audience age mix. See section 3.
- URLs checked: https://www.bfi.org.uk/industry-data-insights/statistical-yearbook, https://www.bfi.org.uk/terms-use, https://www.bfi.org.uk/industry-data-insights, https://www.bfi.org.uk/industry-data-insights/official-statistics-release-calendar, https://core-cms.bfi.org.uk/media/43652/download, /43651/, /43653/, /43722/.

#### BFI weekend box office reports

- What (verified by opening the 6 to 8 November 2026 file): one ODS sheet per weekend with Rank, Film, Country of Origin, Weekend Gross (GBP, Fri to Sun incl. previews), Distributor, % change on last week, Weeks on release, Number of cinemas, Site average, Total gross to date. Covers the top 15 plus "Other UK films" and "Other new releases". Notes give preview grosses and "fall-off without previews", market comparisons (against last weekend, same weekend last year, rolling 52-week norm) and a list of next week's openers with distributors.
- History: yearly pages back to 2017 (older years exist on the old site, not checked).
- Licence: same BFI site terms (personal and non-commercial). The underlying figures are Comscore's. `https://core-cms.bfi.org.uk/robots.txt` reads `User-agent: * Disallow: /`, so automated collection from the file host is not welcome.
- Decision: we did not bulk-download the archive. We opened one file to document the format. Bulk use for commercial calibration needs written permission from BFI (and possibly Comscore).
- Pulse use if permitted: UK week-on-week decay by opening size and country of origin (the decay prior is currently from US literature, see 3.3); "openers next week" as a competition input for screen allocation. Value is high, so this is the first permission request to send.

#### UK Cinema Association monthly admissions

- The UKCA monthly admissions page did not load through our fetch tool and a direct request was refused by our environment's safeguards, so nothing here is verified. Secondary sources say 2024 admissions were 126.5m (CAA) and 2025 about 123.5m (Savills). The BFI yearbook monthly table already carries CAA monthly figures with attribution, so UKCA adds recency only. Ask UKCA for reuse terms.

#### Comscore, Box Office Mojo, The Numbers

- Comscore: the census source behind BFI and press figures. Paid. Note only.
- Box Office Mojo is an IMDb service. IMDb conditions (verified): "You may not use data mining, robots, screen scraping, or similar data gathering and extraction tools on this site" and the services "may not be ... exploited for any commercial purpose" without written permission. Avoid.
- The Numbers: the terms page returned 404 for us. The owner (Nash Information Services) sells OpusData subscriptions. Treat as paid. Avoid scraping.

#### Wikidata and Wikipedia box office figures

- Wikidata box office (P2142) is CC0 but sparse and mostly worldwide or US totals. Wikipedia text is CC BY-SA 4.0 (share-alike), which would infect anything we publish that copies it. Use Wikidata for structure (franchise, genre, release dates), not for UK grosses.

### 2.2 Film metadata and hype signals

#### TMDB (existing integration): a blocker

Verified on https://www.themoviedb.org/api-terms-of-use:

- 1.A: the licence "does not permit any commercial use of TMDB, the TMDB APIs, or TMDB Content". 2.A: commercial users "must enter into a written agreement with TMDB", which "may be subject to ... payment of fees". TMDB decides what is commercial.
- 1.C: no caching "for longer than 6 months", and no use "in connection with, including for training, a machine learning (ML) or artificial intelligence (AI) based Application".
- 3: TMDB logo plus the notice "uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB".
- The API for Business page offers commercial access but publishes no prices.

Consequence: Pulse learns multipliers from data. Whether empirical-Bayes shrinkage counts as "ML" is TMDB's call, not ours. This matches `docs/film-data-providers.md`, which already gates TMDB enrichment behind `TMDB_COMMERCIAL_LICENCE=confirmed`. Pulse must not use TMDB fields in production until a written agreement explicitly covers forecasting. Fields worth negotiating for: `release_dates` (per country with type 1 Premiere, 2 Theatrical limited, 3 Theatrical, 4 Digital, 5 Physical, 6 TV, plus certification; verified on the API reference), `popularity`, `vote_count` (velocity needs our own snapshots, which the 6-month cache cap limits), `keywords`, `belongs_to_collection` (franchise), `budget` and `revenue` (sparse, mostly US). There is no popularity history endpoint as far as we know, so history would have to be our own snapshots.

#### Wikimedia pageviews API (recommended hype signal)

- What: daily (or monthly) views per article, per project, filterable by access (desktop, mobile) and agent (user, spider, automated). Data from 1 July 2015 (verified on the AQS reference). Endpoint pattern tested: `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/{Article}/daily/{YYYYMMDD}/{YYYYMMDD}`.
- Licence: "Data from the API is available under the CC0 1.0 license" (access policy page) and "All Analytics datasets are available under the Creative Commons CC0 dedication" (dumps readme). Verified. Commercial use fine; attribution courteous, not required.
- Access rules: every request needs a descriptive User-Agent with contact details; serial requests; clients that endanger stability may be blocked. During our run the API returned HTTP 429 several times, so a production job must back off and cache. Bulk dumps exist at dumps.wikimedia.org for backfills.
- Limits: views are global per language edition, not per country. English Wikipedia is dominated by US readers, so it measures global English-language hype, not UK hype specifically. UK-only titles (for example Indian or Polish releases for diaspora audiences) are better tracked on their own language editions.
- Evidence: Mestyan, Yasseri and Kertesz (2013, PLOS ONE, CC BY) predicted US opening-weekend revenue with cross-validated R2 of about 0.77 one month before release from pageviews, editors, edits and theatre count; pageviews alone were about as good as theatre count alone. Our own quick UK calibration is in section 3.6.
- Pulse use: film multiplier input ("hype index" = log of views in days -35 to -7 before UK release relative to comparable titles). Explainable: "Wikipedia interest is 3x a typical 12A family release four weeks out".

#### Wikidata (franchise, sequels, genre)

- Licence: structured data in main, Property, Lexeme and EntitySchema namespaces is CC0 (verified on Wikidata:Licensing).
- Useful properties: P179 (part of the series), P155/P156 (follows / followed by), P136 (genre), P577 (publication date) with qualifier P291 (place of publication, UK = Q145), P2047 (duration), P1657 (MPA rating; BBFC rating is P2629 where present), P4947/P345 (TMDB / IMDb ids for matching).
- Reliability note from this research: the SPARQL endpoint was rate limiting to "1 req / min" during an outage, and the `wbgetentities` API returned 429. `Special:EntityData/{QID}.json` still worked. Production should cache entities and use the weekly JSON dumps for backfills.
- Pulse use: sequel and franchise flags (sequels open bigger and decay faster, per our legs table), genre for the film prior, UK release date cross-check.

#### Google Trends

- Official API is alpha only: "we can't open the API for everyone yet", five-year rolling window, daily to yearly aggregation, sub-region geography (verified on developers.google.com/search/apis/trends). No published commercial terms or pricing. Scraping the Trends website is against Google's terms. Avoid; apply for the alpha if UK sub-region search interest becomes a priority.

#### YouTube Data API

- Developer policies (verified): non-authorised statistics such as view counts must not be stored over 30 days; "must not ... access or use API Data to create new or derived data or metrics"; no aggregation except for a channel owner. A trailer-view time series is exactly the forbidden derived metric. Avoid.

#### Letterboxd, IMDb datasets, OMDb, MovieLens

- Letterboxd API docs return 403; the API is granted privately. Avoid.
- IMDb datasets: "available ... for personal and non-commercial use" (verified). Commercial requires an IMDb licence. Avoid.
- OMDb terms (verified, last updated 2015): personal use only; "You may not build a business utilizing the Contributions". Avoid.
- MovieLens: GroupLens page says to read each dataset's README for terms and that they "typically do not permit public redistribution". The README itself returned 503, so terms are not verified. Avoid; it is US user ratings data and not a fit anyway.

### 2.3 Calendars

#### gov.uk bank holidays (existing)

- Verified: JSON with divisions `england-and-wales`, `scotland`, `northern-ireland`; each event has `title`, `date`, `notes` (for example "Substitute day"), `bunting`. Coverage 2019 to 2028.
- Licence: GOV.UK terms: "Most content on GOV.UK is subject to Crown copyright protection and is published under the Open Government Licence (OGL)"; footer "All content is available under the Open Government Licence v3.0, except where otherwise stated". The JSON has no exception, so OGL v3.0 applies. Attribution line: "Contains public sector information licensed under the Open Government Licence v3.0."
- Pulse use: already in `shared/fixtures/calendar/bank-holidays.json`. Use the venue's nation to pick the division.

#### School term dates

- No national dataset. Term dates are set per local authority for community schools, and academies can differ. Councils publish open data individually (examples found: East Sussex XML, Leeds CSV to 2020/21, Lincolnshire). Scotland and Northern Ireland differ again. A Traveline "Education Term Codes Database" was listed by search but its page returned 404 for us.
- Current fixture `school-holidays-england-wales.json` is an approximation, correctly labelled as such.
- Recommendation: per-venue term calendar chosen from the local authority, editable by the operator, default to the approximation. Store source and licence per entry.

#### Sports fixtures

- Football DataCo FAQ (search-verified): "Fixture lists do not benefit from any protection under UK or EU law and as such no licence is required to reproduce fixture lists." Logos and match data still need licences.
- openfootball/football.json (verified): CC0, Premier League, Championship, League One and Two and major European leagues, seasons 2010-11 to 2026-27, auto-updated daily. Fields include round, date, teams, score. Kick-off times do not appear to be included, which limits slot-level use.
- football-data.org: free tier 12 competitions, 10 calls/minute; commercial use on the free tier not stated (verified pricing page; terms page 404). Ask before use.
- Major tournaments (World Cup, Euros; note Euro 2028 is hosted in the UK and Ireland) are few enough to curate by hand into the calendar fixture.
- Pulse use: "big match" flag as a negative multiplier on overlapping evening slots, learned per venue. Start with a curated list of England, Scotland and Wales matches and finals, then add league fixtures for venues near stadiums.

#### Local events

- Ticketmaster Discovery (verified terms): no selling or sublicensing of the API, caching only "for reasonable periods in order to provide the service", Ticketmaster may rate limit calls not tied to user actions. Commercial forecasting use is not addressed. Ask.
- Skiddle (verified): "The API is for non-commercial use only" unless approved by api@skiddle.com. Ask.
- Eventbrite public event search was shut down on 12 December 2019 (verified). Avoid.
- Practical route: let operators add local events (panto run, festival, stadium concert) in the admin portal. They know their town better than any feed.

#### Clock changes and daylight

- No source needed. UK clock changes come from the IANA time zone database (`Europe/London`), already used for venue times. Sunset can be computed from latitude and longitude with the standard NOAA solar position algorithm. Pulse use: "darkness at 6pm" covariate for early-evening slots and the October clock-change step.

### 2.4 Weather

Is it worth it? Evidence is thin for the UK. Gilchrist and Sands (2016) use weather shocks as an instrument precisely because weather moves US opening-weekend attendance, and find that 100 extra weather-induced opening viewers bring about 50 extra in weekend two and 30 in weekend three (abstract-level; full paper blocked to our fetcher). Moretti (2011) finds weather-driven opening surprises do not change later decay, unlike quality surprises. We found no peer-reviewed UK study with effect sizes; press items (a UK "Weatherbill" report, an ABN AMRO Dutch analysis) suggest hot weather lowers attendance and rain raises it, unverified. Conclusion: weather is worth a backtest on each operator's own history before paying for anything.

#### Met Office Weather DataHub

- Free plans (verified on pricing page): Global spot "Up to 360 calls per day"; Site-Specific Blended Probabilistic Forecast "Up to 55 calls per day". Paid Blended probabilistic from GBP 9/month (550 calls/day) to GBP 16,911/month.
- Terms (verified, "Met Office Weather DataHub Terms Version 13", dated 15 August 2024): clause 3.2 grants "a perpetual, worldwide, non-exclusive, non-transferable licence to download, use, copy, publish, distribute, transmit, adapt, and exploit the Met Office Weather DataHub Products for use in Your Application", provided we do not redistribute or resell the products "in original form" or let users reverse engineer them. Clause 2.6 requires attribution, for example "Data supplied by the Met Office". No separate non-commercial restriction on free plans was found in the terms. Ask Met Office licensing to confirm free-plan commercial use in writing.
- Capacity: one call per venue per refresh. 360 calls/day covers about 90 venues at four refreshes a day.
- Pulse use: live weather adjustment on the next 7 days of screenings, only if the backtest shows an effect.

#### Historical weather for the backtest

- MIDAS Open (Met Office via CEDA): UK hourly and daily station observations under OGL (CEDA catalogue records, search-verified); cite as "Met Office (year): MIDAS Open: UK hourly weather observation data, vYYYYMM". Free with CEDA registration.
- ERA5 (Copernicus Climate Data Store): ECMWF announced the CDS licence would switch to CC BY 4.0 on 2 July 2025, permitting commercial use with credit (search-verified on ECMWF forum, not on the CDS dataset page).

#### Open-Meteo

- Verified: "You may only use the free API services for non-commercial purposes." Paid Standard (1M calls/month), Professional (5M), Enterprise permit commercial use; prices are only shown at checkout. Historical, climate and ensemble APIs need Professional or higher. Data is CC BY 4.0 with the credit "Weather data by Open-Meteo.com", but the UK Met Office model data it relays is listed as CC BY-SA 4.0 (share-alike). Avoid the free tier; the paid tier is a fallback if Met Office terms do not work out.

### 2.5 Demographics and catchment

- ONS licences page (verified): ONS material may be reused "whether commercially or privately" under OGL. Postcode products "are subject to the Open Government Licence" with three attribution lines: "Contains OS data © Crown copyright and database right [year]", "Contains Royal Mail data © Royal Mail copyright and database right [year]", "Source: Office for National Statistics licensed under the Open Government Licence v.3.0". Northern Ireland (BT) postcodes: "you need a separate licence for commercial use direct from Land and Property Services", and ONS issues only an internal-business-use end user licence. This matters for NI operators.
- postcodes.io: MIT-licensed software serving ONSPD and OS Open Names, self-hostable with Docker (verified on GitHub). Self-host for production to avoid rate dependence; the NI caveat still applies to the data.
- Census 2021 via Nomis: OGL under the ONS licence above. The Nomis terms page returned 404, so Nomis-specific API limits are unverified.
- English Indices of Deprivation 2025: published by MHCLG on 30 October 2025 on GOV.UK, LSOA level, nine files (search-verified). GOV.UK default is OGL v3.0. Scotland (SIMD) and Wales (WIMD) are separate indices and not comparable across nations.
- Pulse use: catchment prior for a new venue (population within drive time x regional admissions per head from priors.json), deprivation decile as a price sensitivity prior for pricing suggestions, and loyalty member geography for segmentation. Never store more precise member location than needed; postcode district is enough.

## 3. Derived priors (what is in `priors.json` and how it was made)

All derivations were run on files saved under the session scratchpad (`pulse-data/`, one folder per source); scripts were kept separately and run with `python3 -I`. No raw data was copied into the repo.

### 3.1 Seasonality (month)

Table 2 of the yearbook gives monthly admissions for 2019 to 2023. We dropped 2020 and 2021 (closures), converted each year to monthly shares, averaged 2019, 2022 and 2023, and divided by days in month to get a daily rate index (1.0 = average day).

| Month | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Mean share | 7.2% | 7.9% | 6.8% | 9.2% | 8.9% | 8.4% | 12.1% | 9.5% | 5.9% | 8.1% | 6.6% | 9.3% |
| Daily index (mean) | 0.85 | 1.04 | 0.80 | 1.12 | 1.05 | 1.02 | 1.42 | 1.12 | 0.72 | 0.96 | 0.81 | 1.09 |
| Daily index (2019 only) | 0.92 | 0.90 | 0.76 | 1.11 | 1.11 | 0.96 | 1.24 | 1.04 | 0.76 | 1.09 | 0.84 | 1.24 |

September is reliably the weakest month (0.72 to 0.76) and July the strongest. July 2023 is inflated by Barbie and Oppenheimer, which is why Einav's point matters: observed seasonality is demand times slate. Pulse should use the month index only as a weak prior on the slot baseline and let the venue's own data take over within a year (empirical Bayes, section 4.4).

### 3.2 Film legs (total gross / opening weekend)

From Tables 1 to 3 of "Top films in 2023" (48 distinct films):

- All: median 3.67 (IQR 2.86 to 5.06).
- By opening size: at least GBP 5m: 3.33; GBP 1m to 5m: 3.87; under GBP 1m: 4.00 (coarse, openings rounded to GBP 0.1m).
- By our own grouping (assigned by us, not BFI):
  - Family and animation (Wonka 6.56, Elemental 6.00, The Little Mermaid 5.48, Puss in Boots 5.22, Trolls Band Together 5.06, Super Mario Bros 3.50, Spider-Verse 3.35): median 5.22.
  - Franchise action and superhero (14 titles, e.g. Ant-Man Quantumania 2.19, The Flash 2.07, The Marvels 2.12, Fast X 2.59, GotG 3 3.04): median 2.95.
  - Adult drama and comedy (Oppenheimer 5.45, Barbie 5.20, A Haunting in Venice 4.50, What's Love 4.36, Asteroid City 4.17, Magic Mike 3.87, Napoleon 2.73, Empire of Light 2.29): median 4.27.
- Longest legs were word-of-mouth UK titles: The Great Escaper 8.83, Saltburn 7.00.

Pulse use: before a film has sales, the film's expected run shape (and therefore how many screens to hold in weeks 2 to 4) starts from the group median, then the pace and decay fitted on live sales replace it. This is the "sleeper versus blockbuster" distinction in a form operators understand.

### 3.3 Weekly decay

No openly licensed UK weekly series exists (BFI weekend data is not cleared, section 2.1). The prior therefore comes from Moretti (2011, NBER w13832, read in full): US national weekly sales for 4,992 films, 1982 to 2000, log-linear decline over 8 weeks. Average slope -0.926 log points a week (weekly retention 0.40). Films with a negative opening surprise: -1.25 (0.29); positive: -0.63 (0.53). By surprise tercile: -1.32, -0.98, -0.47 (retention 0.27, 0.38, 0.63). Surprise is the residual of opening sales on screens and film characteristics.

For orientation only (not stored as a prior): in the BFI weekend report for 6 to 8 November 2026, week-2 drops ex previews were 32% and 35% for two openers, and week-3 and week-4 holdovers fell 36% to 66%. UK wide releases appear to hold better than the US average in Moretti's era, so Pulse should treat the Moretti figures as the steep end and shrink towards each operator's observed decay.

Pulse use: decay multiplier per week since release, chosen by the film's surprise tercile (actual week-1 admissions versus Pulse's pre-release forecast, after removing weather and holiday effects). Explanation string: "Opened 40% above forecast, so we expect it to hold like a positive-surprise film (keeps about half its audience week to week)".

### 3.4 Release width, catchment and audience

- Median gross by sites at widest release (Table 6): over 700 sites GBP 27.4m; 600 to 699 GBP 7.1m; 500 to 599 GBP 3.2m; 400 to 499 GBP 0.95m; down to GBP 2,593 for under 10 sites. Use as the film prior when no other signal exists (event cinema, independent titles), translated to the venue via the venue's historical market share.
- Admissions per head by ISBA region (Exhibition Table 1): London 2.19, Northern Ireland 2.09, Central Scotland 2.04, UK 1.81, down to Border 1.22. Average ticket price: London GBP 9.11, UK GBP 7.93, South West GBP 6.72.
- Cinemagoer age profile 2023: 7 to 14: 12%, 15 to 24: 19%, 25 to 34: 20%, 35 to 44: 17%, 45 to 54: 11%, 55+: 21%.

### 3.5 Food and drink

No openly licensed UK concession dataset was found. The only UK figures located are listed-company disclosures: Everyman reported food and beverage spend per head of GBP 11.32 against a paid average ticket price of GBP 12.51 in its FY2025 trading update (search-verified via LSE RNS summaries and Hargreaves Lansdown; primary RNS not opened). That is a premium operator and not a general prior. Not stored in priors.json. Pulse should learn attach rates per venue, format and slot from the operator's own EPOS data from day one.

### 3.6 Hype signal calibration (Wikipedia pageviews)

See the "Pageviews calibration" result appended below. Method: for each of the 48 top 2023 UK films with an English Wikipedia article, we fetched daily user pageviews (CC0) from October 2022 to February 2024, found the peak day (a proxy for release, because the Wikidata release-date lookup was rate limited), summed views from 35 to 7 days before the peak, and regressed log UK opening weekend gross on log pre-release views.

Result (42 of 48 films matched; misses: Dungeons & Dragons, Magic Mike's Last Dance, Love Again, The Canterville Ghost, Rise of the Footsoldier, because our article title guess was wrong or the API kept returning 429; the Love Actually re-release was not attempted):

| Model (log opening weekend GBP) | Slope(s) | In-sample R2 | Leave-one-out R2 | Residual SD (log) |
|---|---|---|---|---|
| log pageviews, days -35 to -7 | 0.70 | 0.72 | 0.68 | 0.84 |
| log pageviews, last 7 days before peak | 0.62 | 0.75 | 0.72 | 0.79 |
| log sites at widest release | 2.25 | 0.61 | 0.55 | 0.99 |
| log pageviews (-35 to -7) + log sites | 0.49 and 1.16 | 0.81 | 0.77 | 0.70 |
| pageviews only, wide releases (600+ sites, n = 29) | 0.60 | 0.73 | 0.69 | n/a |

Reading: doubling pre-release English Wikipedia interest goes with a UK opening about 1.6 times larger on its own, or about 1.4 times larger once release width is accounted for. A month out, pageviews alone predict UK openings better than release width alone, and together they explain about three quarters of the variation out of sample, close to Mestyan et al.'s US figure.

Caveats: small sample of successful 2023 films (survivorship); the peak day is a proxy for release and sometimes reflects the US release or a streaming launch (Saltburn and How to Have Sex peaked on 30 December 2023, after UK release); widest-release sites are only known after the fact. Treat the 0.5 to 0.7 elasticity as a starting prior for the hype term, shrunk and refitted on each operator's films once we hold real UK release dates (Wikidata P577 with UK qualifier, or the operator's own booking feed).

Licence position: pageviews CC0; opening grosses from the BFI yearbook (quote-with-attribution); the fitted slopes are our own derived statistics.

## 4. Methods and evidence

### 4.1 Evidence library

| Citation | Access | Key finding (as read) | How Pulse uses it |
|---|---|---|---|
| Moretti, E. (2011) "Social Learning and Peer Effects in Consumption: Evidence from Movie Sales", Review of Economic Studies 78(1):356-393. Open WP: https://www.nber.org/papers/w13832 | Read in full (NBER PDF) | Weekly sales decline is "remarkably log linear"; average slope -0.926 per week; positive-surprise films -0.63, negative -1.25; screens in week 1 explain about 90% of week-1 sales variation (R2 0.907); weather surprises do not change later sales | Decay prior by surprise tercile (priors.json `weeklyDecay`); justifies log-scale models |
| Gilchrist, D. S. and Sands, E. G. (2016) "Something to Talk About: Social Spillovers in Movie Consumption", JPE 124(5). https://doi.org/10.1086/688177 | Abstract and summaries only (PDF 403) | Weather shocks shift opening weekend; per 100 extra opening viewers, about 50 more in weekend 2 and 30 in weekend 3 | Do not "correct" a weather-boosted opening down too fast; supports a weather backtest |
| Mestyan, M., Yasseri, T., Kertesz, J. (2013) "Early Prediction of Movie Box Office Success Based on Wikipedia Activity Big Data", PLOS ONE 8(8):e71226 | Read (CC BY) | 312 US films (2010); pageviews, editors, edits plus theatre count give R2 about 0.77 one month before release; better for high-grossing films | Hype index input to film prior |
| Sawhney, M. S. and Eliashberg, J. (1996) "A Parsimonious Model for Forecasting Gross Box-Office Revenues of Motion Pictures" (BOXMOD), Marketing Science 15(2):113-131 | Abstract only | Adoption = time-to-decide (information) + time-to-act (access), exponential or Erlang-2 or generalised gamma; cumulative revenue often within 10% using 2 to 3 weeks of data; shape parameters hard to predict pre-release | Two-stage explanation of pace: "awareness" (hype index) and "access" (showtimes, screens). Supports switching from prior to fitted curve after 2 to 3 weeks |
| Einav, L. (2007) "Seasonality in the U.S. Motion Picture Industry", RAND Journal of Economics 38(1):127-145. SIEPR WP 2003 | Abstract only | Underlying demand seasonality is much smaller than observed sales seasonality, because the biggest films are released into peak periods | Keep month and holiday priors weak; model film strength separately from slot so seasonality is not double counted |
| De Vany, A. and Walls, W. D. (1999) "Uncertainty in the Movie Industry: Does Star Power Reduce the Terror of the Box Office?", Journal of Cultural Economics 23(4):285-318 | Abstract only | Revenues are asymptotically Pareto with infinite variance; over 2,000 films; stars do not remove the uncertainty | Work in logs, use medians and quantile bands, show ranges not point forecasts, cap multipliers |
| Weatherford, L. R. and Kimes, S. E. (2003) "A Comparison of Forecasting Methods for Hotel Revenue Management", International Journal of Forecasting 19(3):401-415 | Abstract and secondary summaries (Cornell PDF rate limited) | Pickup methods and regression had the lowest error on Choice Hotels data; exponential smoothing, pickup and moving average most robust on Marriott data; booking-curve (multiplicative) and combinations did worse | Pace projection: additive pickup as default, multiplicative only as a fallback for new venues |
| Gil, R. and Hartmann, W. R. (2009) "Empirical Analysis of Metering Price Discrimination: Evidence from Concession Sales at Movie Theaters", Marketing Science 28(6):1046-1062 | Abstract only | Spanish chain data: customers with higher willingness to pay for admission buy more concessions; high concession prices act as metering | Food forecast per admission should vary with ticket type and film; pricing suggestions should consider concession margin, not ticket alone |
| de Roos, N. and McKenzie, J. (2014) "Cheap Tuesdays and the Demand for Cinema", International Journal of Industrial Organization 33:93-109 | Abstract only (paywalled) | Uses Sydney 2007 discount-Tuesday price variation to estimate price elasticities in a random-coefficients model | Method reference for estimating discount-day elasticity from an operator's own discount nights; no number taken |
| Orbach, B. Y. and Einav, L. (2007) "Uniform Prices for Differentiated Goods: The Case of the Movie-Theater Industry", International Review of Law and Economics 27(2):129-153 | Abstract only | Uniform pricing persists despite clear demand differences across films and times | Context for pricing suggestions: start with time-of-day and day-of-week differentiation, which operators already accept |
| Fader, P. S., Hardie, B. G. S., Lee, K. L. (2005) "RFM and CLV: Using Iso-Value Curves for Customer Base Analysis", JMR 42(4):415-430 | Abstract only | Pareto/NBD for timing plus gamma-gamma for spend links RFM to lifetime value | Loyalty segmentation: RFM tiles for explainability, Pareto/NBD or BG/NBD later for "likely lapsed" alerts |
| Efron, B. and Morris, C. (1975) "Data Analysis Using Stein's Estimator and Its Generalizations", JASA 70(350):311-319 | From memory, not re-read | Shrinking small-sample rates towards a group mean beats raw rates in total squared error | The shrinkage behind every learned multiplier (see 4.4) |
| Agrawal, R., Imielinski, T., Swami, A. (1993) "Mining Association Rules between Sets of Items in Large Databases", SIGMOD | From memory, not re-read | Support, confidence and the Apriori-style rule search | Basket analysis (see 4.6) |
| Gans, N., Koole, G., Mandelbaum, A. (2003) "Telephone Call Centers: Tutorial, Review, and Research Prospects", M&SOM 5(2):79-141 | From memory, not re-read | Erlang C and square-root staffing as standard queueing practice | Till and kiosk staffing (see 4.5) |
| Krider, R. E. and Weinberg, C. B. (1998) "Competitive Dynamics and the Introduction of New Products: The Motion Picture Timing Game", JMR 35(1) | From memory, not re-read | Films differ in opening strength and decay; release timing is a game against competing titles' decay | Competition term: overlapping wide openers reduce each other's week-1 share |
| Elberse, A. and Eliashberg, J. (2003) "Demand and Supply Dynamics for Sequentially Released Products in International Markets: The Case of Motion Pictures", Marketing Science 22(3) | From memory, not re-read | Screens drive revenue and revenue drives screens; prior-market performance predicts later markets | US opening (where earlier) can inform UK prior when release is staggered |

Open-access search status: we searched for recent arXiv and open-repository work on box-office forecasting and found mostly theses and conference papers of limited rigour, none UK-specific. No open UK study of day-of-week or hour-of-day cinema attendance was found. Day and time patterns must be learned from operator data.

### 4.2 Prior structure

Pulse's forecast for a screening is prior x multipliers x pace:

1. Slot prior: venue baseline for day of week and start hour, times month index (3.1), times holiday and school-term multipliers, times daylight covariate. Until a venue has history, day-of-week and hour start flat and the month index carries the national shape.
2. Film multiplier: from release week, format and film strength. Pre-release strength comes from hype index (pageviews), franchise flag (Wikidata), release width, certificate and genre group; TMDB fields only after a commercial agreement.
3. Decay: week-since-release multiplier using the legs and surprise-tercile priors (3.2, 3.3), replaced by the fitted decay for that film across the operator's venues after two weekends.
4. Pace: booking-curve projection for each screening (4.3).

All multipliers are shown to operators with their reason and the evidence count behind them.

### 4.3 Booking pace (pickup)

- Additive pickup: forecast final = bookings now + average historical pickup from this lead time to showtime, for comparable screenings (same venue, day type, hour band, film group). This is the method that did best in Weatherford and Kimes.
- Multiplicative (booking curve): forecast final = bookings now / average fraction booked by this lead time. It is unstable when bookings now are small and over-reacts to early blocks (group bookings), so use it only when there is no history for additive pickup.
- Blend with the prior: weight the pace estimate by how much of the final audience is typically booked by this lead time (for example, at 7 days out on a Tuesday matinee little is booked, so the prior dominates; on opening Friday evening most of the demand is visible).
- Cap demand at capacity and mark sell-outs as censored; unconstrained demand needs the sell-out time to estimate turned-away customers.

### 4.4 Empirical Bayes shrinkage

For any rate learned from small counts (for example, venue X's Sunday 11:00 multiplier), use the posterior mean: (n x observed + k x prior) / (n + k), where n is the number of comparable screenings observed and k is a pseudo-count chosen per multiplier (estimate k from the spread of the multiplier across venues, method of moments, as in Efron and Morris). Show operators "based on 14 screenings, pulled 30% towards the chain average" so the shrinkage is explainable. For admissions use a gamma-Poisson (negative binomial) form; for conversion-type rates (attach rate, sell-out probability) use beta-binomial.

### 4.5 Staffing (Erlang C)

Treat each till or kiosk bank as an M/M/c queue per 15-minute interval. Arrival rate lambda comes from Pulse's admissions forecast times the share of customers who queue (from EPOS: share buying food, share collecting tickets at the desk) distributed over the 30 to 0 minutes before each start time. Service time comes from EPOS transaction durations. Erlang C gives the probability of waiting and the average wait for c staff; choose the smallest c that meets a service level (for example 80% served within 3 minutes). Square-root staffing (c = a + beta x sqrt(a), with a = lambda x mean service time) is a readable approximation for operators. Peaks before simultaneous starts dominate, which also feeds a "stagger start times" suggestion.

### 4.6 Basket analysis and segmentation

- Basket: use support, confidence and lift on EPOS baskets per visit. Only surface rules with lift clearly above 1 and enough support to matter (for example at least 1% of baskets and at least 200 baskets), and always show the counts. No published cinema-specific norms for lift or attach rates were found.
- Segmentation: RFM tiles (recency, frequency, monetary) for loyalty members are fully explainable. Later, Pareto/NBD or BG/NBD (Fader, Hardie and Lee) gives "probability still active" for lapsed-member alerts.

### 4.7 Anomaly alerts

Alert when actual admissions fall outside the forecast's quantile band (for example the 5% to 95% band on the log scale) after accounting for known shocks (weather, events). Because box office is heavy-tailed (De Vany and Walls), alert thresholds should be on log ratios, not absolute differences.

## 5. Recommended next integrations (value versus effort)

1. Calendar completeness (high value, low effort). Per-venue school term calendar picked from the local authority with operator override; Scotland and NI term patterns; IANA clock changes and computed sunset; curated major football tournaments and finals. All OGL, CC0 or computed.
2. Wikimedia pageviews hype index (high value, low effort). Daily job, polite User-Agent, backoff on 429, store per-film daily views. CC0. Map films to articles via Wikidata ids.
3. Wikidata film enrichment (medium-high value, low effort). Series, follows, genre, UK release date, IMDb and TMDB ids. CC0. Cache entities; avoid SPARQL in the hot path.
4. Permission requests (high value, low effort, slow). Email BFI RSU for (a) commercial use of yearbook-derived priors with attribution and (b) permission to use the weekend box office archive for decay calibration and the "openers next week" list. Email UKCA for monthly admissions. Email Met Office licensing to confirm free-plan commercial use.
5. TMDB commercial agreement decision (high value, unknown cost). Required before any TMDB field touches Pulse in production; the agreement must explicitly allow forecasting and the cache period we need.
6. Weather backtest (medium value, medium effort). Pull MIDAS Open (OGL) or ERA5 (CC BY) for each venue's history, test whether rain, heat and temperature anomaly explain residuals. Only if they do, add Met Office DataHub forecasts (free 360 calls/day Global spot, then GBP 9/month tier).
7. Catchment priors (medium value, medium effort). Self-hosted postcodes.io plus Census 2021 and IoD 2025 for new venues and loyalty geography. Handle BT postcodes under the NI licence rules.
8. Local events (medium value, high effort). Operator-entered events first; Ticketmaster or Skiddle only after written commercial approval.

## 6. Open questions and risks

- TMDB: the free licence forbids commercial use and ML/AI use, and limits caching to 6 months. Until a written agreement exists, Pulse must not depend on TMDB popularity, votes or release dates in production. This is the biggest risk to the film prior.
- BFI: no open licence on the yearbook or weekend reports; site terms say personal and non-commercial. Our priors from the yearbook are aggregates with attribution, but we have not had BFI's written agreement. The underlying data is Comscore's, so BFI may need to refer us.
- Pageviews measure global English-language interest, not UK interest; the peak-day proxy for release date uses the global (often US) release, which can precede the UK release by weeks (for example Puss in Boots: The Last Wish peaked in January 2023, the US release window).
- Weather: no UK effect sizes verified. Met Office free-plan commercial use is implied by the licence text but not explicitly stated; Open-Meteo relays Met Office data under CC BY-SA (share-alike) which could affect anything we publish from it.
- Northern Ireland postcodes need an LPS commercial licence.
- Not verified this session (pages blocked, 404 or rate limited): UKCA monthly admissions page and terms; MovieLens README; The Numbers terms; Nomis terms; football-data.org terms; Traveline education terms database; Gilchrist and Sands full text; Weatherford and Kimes full text; Einav, Sawhney and Eliashberg, De Vany and Walls, Gil and Hartmann, de Roos and McKenzie full texts; Efron and Morris, Agrawal et al., Gans et al., Krider and Weinberg, Elberse and Eliashberg (cited from memory).
- Wikimedia and Wikidata services rate limited us heavily during this research (WDQS "1 req / min" during an outage). Production jobs must cache, back off, and use dumps for backfills.
- Moretti's decay figures are US 1982 to 2000 with longer windows; UK holds appear better. Priority is to calibrate decay on operators' own multi-venue data.
- Day-of-week and hour-of-day priors have no open UK source; they will be flat until each venue has history (or a chain-level pooled prior across our tenants, which needs each operator's consent in the contract).
