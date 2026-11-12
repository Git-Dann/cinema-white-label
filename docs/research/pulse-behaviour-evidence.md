# Seatfold Pulse: how people decide to go to the cinema (evidence base)

Research date: 11 November 2026. Scope: free, open-access evidence on cinema-going behaviour that Pulse can turn into parameters. UK first, then Europe, then elsewhere. This document adds to [pulse-data-sources.md](../pulse-data-sources.md) (licences, national priors, evidence library in section 4) and does not repeat it. Where a paper is already in that library (Moretti 2011, Gilchrist and Sands 2016, Mestyan et al. 2013, Sawhney and Eliashberg 1996, Einav 2007, De Vany and Walls 1999, Weatherford and Kimes 2003, Gil and Hartmann 2009, de Roos and McKenzie 2014, Orbach and Einav 2007, Fader, Hardie and Lee 2005, Krider and Weinberg 1998, Elberse and Eliashberg 2003), we only add what we newly read.

Machine-readable values: [`shared/fixtures/pulse/behaviour-priors.json`](../../shared/fixtures/pulse/behaviour-priors.json).

## How to read this

Every figure says how we got it:

- **Read**: we opened the full text (or the full report) and the figure comes from the page or table named.
- **Read (figure)**: we read the number off a chart in the full report; small rounding is possible.
- **Abstract**: from the publisher or repository abstract only.
- **Secondary**: from another paper or a search summary quoting the source; we did not open the source itself.
- **Memory**: from prior knowledge, not re-read in this session.
- **Derived**: our own arithmetic on figures from a named source. The working is shown.
- **Assumption**: no source found. An engineering starting value that operators' own data must replace.

Page numbers are the printed page where the document has one (journal pages for Einav and Moon et al., report pages for the Competition Commission survey and the CNC studies) and the PDF page otherwise (working papers and repository copies, which often add cover pages).

Confidence in the tables: **high** (UK or close market, large sample, read in full, behaviour measured), **medium** (good study but another market, era or stated preference), **low** (thin, indirect, secondary or assumption).

Licence flags follow `priors.json`: `open` (OGL, CC BY, CC0, or an explicit reuse permission such as the CNC's "source CNC" notice), `quote-with-attribution` (published figure, no open licence, cite it), `literature` (a number from a paper, used as a cited prior), plus `derived` and `assumption` as above.

## Summary: what changes for Pulse

1. **Same-night choice now has measured anchors.** Einav's nested logit puts the "all films versus not going" correlation at σ = 0.52 (dissimilarity 1 − σ ≈ 0.48), which is lower than the 0.75 `lambdaCross` working value in `choice.ts`. A UK customer survey for the Competition Commission (21,797 interviews) shows how few people drop out when their cinema is unavailable: 8% of multiplex and 25% of arthouse admissions would not have gone to the cinema at all. Most people pick the film first (62 to 75%), but most multiplex customers pick the day first (66%).
2. **There is finally an open UK day-of-week shape.** The same survey gives the day of the last visit: at Cineworld, Saturday 34%, Sunday 17%, Friday 13%, Monday 6% of recalled visits. Before this, `pulse-data-sources.md` said no open UK source existed.
3. **Occasion mix.** UK multiplex: 40% couples, 31% families, 21% friends, 7% alone. Arthouse: 50% couples, 8% families, 26% friends, 15% alone. France 2026: 19% alone, 32% couples, 34% families, 15% friends. Solo visits are concentrated among the most frequent cinemagoers (a third of weekly-or-more visitors go alone).
4. **Decision timing.** In France, 28% decide on the day, 34% the day before and 39% several days ahead; 42% book in advance (up from 26% in 2019). Larger UK arts parties book earlier and cheaper tickets sell later. This is enough to shape the pace prior by party size.
5. **Price.** The evidence splits cleanly by level. Whole-market elasticity is low (about −0.2 to −0.6). A venue or chain that moves alone loses far more (stated −1.6 to −7). A single show or film inside a venue is the most elastic (−4 to −6.5 in Hong Kong). The `priceElasticity: −0.7` working value is a market-level number; for one show the evidence says −2 is a better centre.
6. **Weather and sport, Europe.** Major football tournaments cut per-capita box office by about 15% (UK and Spain) to 18% (Spain). Hotter weeks reduce attendance by roughly 1% per °C of weekly maximum temperature in a four-country European panel. In China, rain reduces attendance (−1.5% light to −4.6% torrential), so "rain fills cinemas" is not safe to assume.
7. **Habit.** In France 3% of cinemagoers (weekly or more) make 24% of admissions and the 72% who go less than monthly make 29%. In the US, 11% of people buy 48% of tickets. This is the shape the loyalty module should expect.
8. **Concessions.** UK 2013: half of multiplex customers and a third of arthouse customers bought nothing for themselves; multiplex buyers favour snacks and soft drinks, arthouse buyers hot drinks and alcohol. France 2026: 38% bought popcorn, 54% of 15 to 24 year olds. Food and drink per patron is about 0.5 (AMC International, including Odeon) to 0.68 (AMC US) of the average ticket price.
9. **Seat choice is the thinnest topic.** No open study of real cinema seat-choice logs was found. The method to implement is a conditional logit over available seats, fitted on Seatfold's own booking order, which is data almost nobody else has.

Three method papers to implement first (details in section 11): Einav (2007) nested logit for same-night substitution; a discounted Bass trajectory update after the opening weekend (Dellarocas, Awad and Zhang 2004/2007, with Sawhney and Eliashberg 1996 as the fallback form); and the BG/NBD model (Fader, Hardie and Lee 2005) for lapsing.

---

## 1. Choice and substitution between films on the same night

### Findings

**Einav (2007), "Seasonality in the U.S. motion picture industry", RAND Journal of Economics 38(1):127-145.** Read (scanned author PDF, http://web.stanford.edu/~leinav/pubs/RAND2007.pdf). Weekly US national box office, 1985 to 1999, 1,956 films, 16,103 film-weeks.
- Model (p.134, eq. 1 to 5): nested logit with one nest for all films and an outside good (not going). Mean utility `θ_j − λ(t − r_j) + τ_t`: film fixed effect, linear decay per week since release, week-of-year effect. Estimating equation `log(s_jt) − log(s_0t) = θ_j − λ(t − r_j) + τ_t + σ log(s_jt / (1 − s_0t)) + ξ_jt`, with the number of films on release as the instrument for the within-nest share (p.136).
- Estimates (Figure 3 table, p.137): with film fixed effects λ = 0.220 (s.e. 0.0014), σ = 0.524 (0.030), R² 0.876; without film effects λ = 0.163, σ = 0.577.
- p.138: "The estimated decay coefficient in the benchmark model is −0.22 ... while the market expansion parameter, σ, is 0.52 ... The two coefficients imply an estimated decay of revenues of 37%". Endogenous film quality amplifies observed seasonality by about 50%.
- p.139: decay varies by release season: −0.194 for holiday releases, −0.206 to −0.216 for winter, spring and early summer, −0.249 and −0.244 for late summer and fall.
- Figure 2 (p.133): industry share of the defined market ranges from about 0.03 to 0.15 per week, so the outside option takes 85 to 97% of the market in any week.

**Davis (2001 working paper; published 2006, RAND Journal of Economics 37(4):964-982), "Spatial competition in retail markets: movie theaters".** Read (MIT working paper, December 2001, http://web.mit.edu/pjdavis/www/papers/movies.pdf). 607 US theatres, 36 markets, 1996 to 1997, random-coefficients logit with consumers placed at census tracts.
- Table 4 (p.13): distance enters utility as −0.114 × miles (t 3.04) + 0.002 × miles² (t 2.79). First week of national release: +1.755. Theatre screens +0.039 per screen.
- p.15: implied marginal cost of travel about $1.18 per mile at the theatre door, falling with distance; the magnitude is sensitive to an imprecise price coefficient, "although the shape of the estimated transport cost function is not".
- Table 5 (p.15): the revenue gain to a theatre from local population growth falls by 67 to 73% between the 0 to 5 mile band and the 15 to 20 mile band; business stealing across theatres is "small and significantly decrease[s] with distance" (abstract).
- Derived: relative pull of a cinema at distance d is exp(−0.114 d + 0.002 d²): 0.59 at 5 miles, 0.39 at 10, 0.28 at 15 miles.

**Competition Commission (2013), "Cineworld/City Screen Inquiry: a research report", GfK NOP.** Read (https://assets.publishing.service.gov.uk/media/5329dde2e5274a2268000213/report.pdf). Online survey, July 2013, 21,797 members and online-registered customers of 14 Cineworld and 11 Picturehouse cinemas in 10 UK areas; plus a telephone check of non-registered customers in Brighton and Bury St Edmunds. Published on GOV.UK; we treat it as OGL v3.0 (the PDF itself carries no licence line).
- Film or cinema first (Figure 15, p.22): "knew the film I wanted, then found out it was on at this cinema" 75% Cineworld, 62% Picturehouse; "knew I wanted this cinema, then chose the film" 25% and 37%.
- Day or film first (Figure 16, p.23): "knew the day I wanted to go" 66% Cineworld, 43% Picturehouse; "chose the film, then went on a day it was showing" 33% and 55%.
- Price diversion (Figure 21, p.29): if all fascia cinemas raised prices by 5% (50 to 75p) and others did not, Cineworld admissions: 64% same cinema, 25% another cinema of another operator, 6% Picturehouse, 3% another Cineworld, 3% would not have gone. Picturehouse admissions: 92% same, 4% other, 2% Cineworld, 1% another Picturehouse, 1% not gone.
- Forced diversion (Figure 22, p.31): if all fascia cinemas were closed for a year, Cineworld admissions: 8% not gone at all, 15% Picturehouse, 78% other cinemas. Picturehouse: 25% not gone, 25% Cineworld, 50% other cinemas. Table 6 (p.32) shows a wide range by site (for example Aberdeen Picturehouse 35% not gone).
- Drivers (Figure 17, p.24, % essential or very important, Cineworld vs Picturehouse): choice of films 88% / 93%, ease of getting there 80% / 64%, performance times 75% / 64%, ticket price 72% / 63%, parking 59% / 23%, loyalty scheme 24% / 50%, price of food and drink 26% / 19%.
- Journey time (Figure 11, p.19): 10 minutes or less 21% / 19%, 11 to 20 minutes 37% / 37%, 21 to 30 minutes 24% / 26%, 31 to 40 minutes 10% / 11%, over 40 minutes 8% / 7%; average "just over twenty minutes" (p.18). 89% / 88% travelled from home (Figure 9).

**CNC (2026), "Les pratiques cinématographiques des Français en 2026".** Read (https://www.cnc.fr/documents/36995/2526340/Les+pratiques+cin%C3%A9matographiques+des+Fran%C3%A7ais+en+2026.pdf). CinExpert weekly survey (Vertigo), people aged 15+ who went in the last 7 days. Reuse notice p.36: "toute reproduction partielle ou totale est autorisée sous réserve de la mention : source CNC".
- p.23: 70.0% always go to the same cinema (82.5% in 2025; 78.0% in 2016). Proximity to home is the first reason for choosing a cinema (75.1%, table p.24); ticket price 13.1%; holding an unlimited card 11.4%.
- p.22: mean journey 15 minutes; 93.5% under 30 minutes; 6.5% over 30 minutes.
- p.13: 82.1% chose the film before leaving for the cinema; 17.9% chose on site.

**Ho, Rysman and Wang (2020), "Demand for Performance Goods: Import Quotas in the Chinese Movie Market".** Read (NBER conference paper, https://conference.nber.org/conf_papers/f133054.pdf). p.14: average market share of a film 0.5%, outside option 96% (weekly, China). p.38: summarises de Roos and McKenzie (2014) as an own-price elasticity of about 2.5 and Ho, Liang, Weinberg and Yan (2018, Hong Kong, nested logit) as 5 to 6.5, noting the first is a market elasticity and the second a product (film) elasticity; they calibrate to a product elasticity of 4 (p.39).

**Moul (2007), "Measuring Word of Mouth's Impact on Theatrical Movie Admissions", JEMS 16(4):859-892.** Abstract (Crossref). Film fixed effects and observables explain most variation; about 10% of the variation in consumer expectations is attributable to information transmission. No nesting parameter seen.

**Chiou (2008 working paper version, "The Timing of Movie Releases: Evidence from the Home Video Industry").** Read in part (https://www.oxy.edu/sites/default/files/assets/Economics/Chiou/chiou_timing.pdf). Nested logit on home video; "no evidence of segmentation ... by genre or newness". Suggests genre nests add little; a single "films" nest is a reasonable start.

**Dalton and Leung (2013), "Strategic Decision-Making in Hollywood Release Gaps", MPRA 52439.** Read (https://mpra.ub.uni-muenchen.de/52439/1/MPRA_paper_52439.pdf). Uses Einav's nested logit country by country (17 countries, no UK). Table 3 (p.18): mean weekly "decay elasticity" −0.47; European countries −0.35 (Belgium) to −0.53 (Spain), Germany −0.40, Austria −0.38. Table 2 (p.17): the first two weeks earn 50 to 59% of a film's total in most countries (Germany 0.51, Belgium 0.50, Spain 0.59).

### Parameters for Pulse

| Parameter | Value | Range | Source | Confidence |
|---|---|---|---|---|
| Nesting, all films vs not going (σ) | 0.52 | 0.45 to 0.58 | Einav 2007, p.137 | medium (US, weekly, national) |
| `lambdaCross` in `choice.ts` (= 1 − σ) | 0.50 | 0.40 to 0.75 | Derived from Einav; upper end keeps today's 0.75 | medium |
| `lambdaFilm` (two shows of one film, same session) | 0.30 | 0.15 to 0.45 | Assumption, informed by 62 to 75% "film first" (CC 2013, p.22) | low |
| Share who would not go at all if their cinema were unavailable, multiplex | 0.08 | 0.03 to 0.10 | CC 2013, Figure 22 and Table 6 | high (UK, stated) |
| Same, arthouse or independent | 0.25 | 0.15 to 0.35 | CC 2013, Figure 22 and Table 6 | high (UK, stated) |
| Weekly outside-option share (people in the market who do not go) | 0.96 | 0.85 to 0.97 | Einav 2007 Fig. 2; Ho, Rysman and Wang p.14 | medium |
| Film chosen before the cinema | 0.75 multiplex, 0.62 arthouse | 0.62 to 0.82 | CC 2013 p.22; CNC 2026 p.13 (82%) | high |
| Day chosen before the film | 0.66 multiplex, 0.43 arthouse | 0.43 to 0.66 | CC 2013 p.23 | high (UK) |
| Distance utility per mile | −0.114 (+0.002 × miles²) | −0.08 to −0.15 | Davis 2001 Table 4 | medium (US 1996) |
| Relative pull at 5 / 10 / 15 miles | 0.59 / 0.39 / 0.28 | | Derived from Davis | medium |
| Journey time shares (≤10, 11-20, 21-30, 31-40, >40 min) | 0.20, 0.37, 0.25, 0.105, 0.075 | | CC 2013 Fig. 11 (average of fasciae) | high (UK) |
| Share always using the same cinema | 0.70 | 0.70 to 0.83 | CNC 2026 p.23 | medium (France) |
| Week-on-week decay, Europe (Einav-type model) | retention 0.62 | 0.59 to 0.70 | Dalton and Leung Table 3 (−0.35 to −0.53); Einav 37% decline | medium |
| Share of a film's total earned in weeks 1 and 2 | 0.55 | 0.50 to 0.59 | Dalton and Leung Table 2 | medium |

### Methods worth implementing

- **Einav's estimating equation** on each operator's show-level sales (section 11.1). With `log(s_j) − log(s_0) = film + slot + σ log(s_j | inside) + decay × week`, Pulse can learn σ per operator, using the number of films and shows in the session as the instrument. It is a two-stage least squares regression, so it fits the "no ML library" rule.
- **Davis-style distance decay** for catchment and for "which of our venues does a member belong to". Start with Davis's shape and the CC 2013 journey-time distribution; refit on member postcodes.
- **Diversion ratios as a check.** The CC 2013 diversion questions are a template for a two-question operator survey ("if this show were full / this cinema closed, what would you have done?") that would calibrate `lambdaCross` and the outside share for each operator.

---

## 2. Word of mouth and diffusion: updating a film's trajectory

### Findings

**Duan, Gu and Whinston (2008), "The dynamics of online word-of-mouth and product sales: an empirical investigation of the movie industry", Journal of Retailing 84(2):233-242.** Read (accepted manuscript, CC BY-NC-ND 4.0, https://open.bu.edu/server/api/core/bitstreams/184a2ad3-5e93-46e2-a0d8-2ad522fb7cc4/content). 71 US films, 2003 to 2004, daily Yahoo! Movies posts and grosses, 3SLS.
- Table 5 and p.18: a 10% rise in the volume of user posts goes with +6.3% same-day box office, +1.7% next day, +1.0% the day after. Rating (valence) is not significant once volume is in. A 10% rise in box office raises same-day posts by 4.2% and next-day posts by 1.6% (p.19).
- p.20: weekend days sell 88% more than weekdays, all else equal (3SLS weekend coefficient 0.88; OLS 1.01).

**Dellarocas, Awad and Zhang (2004 working paper; published as Dellarocas, Zhang and Awad 2007, Journal of Interactive Marketing 21(4):23-45).** Read (May 2004 working paper; the copy we read is on an unofficial mirror, https://fravia.deadbsd.org/ccs.mit.edu/dell/papers/movieratings.pdf, so treat page numbers as the working paper's).
- Model (p.16, eq. 1): `dR/dt = (N − R(t)) (p δ^t + q ∫ dR(t − k) δ^k dk)`, a Bass model whose publicity (p) and word of mouth (q) both fade by δ per week.
- p.18: δ = 0.3 per week worked; fitting p and q per film gave average R² 0.976 on weekly revenue (80 US films, 2002).
- p.21 to 23: first-week online rating statistics alone explain 48 to 88% of the variation in p and q across films (adjusted R²); adding first-week box office and marketing raises p to 0.99.

**Moon, Bergey and Iacobucci (2010), "Dynamic Effects Among Movie Ratings, Movie Revenues, and Viewer Satisfaction", Journal of Marketing 74(1):108-121.** Read (https://cdn.vanderbilt.edu/vu-web/owen/files/publications/MovieRatings-JM2010.pdf). Table 3 (p.115): sequels earn more only in weeks 0 and 1; holiday weeks add revenue every week. Table 2: weekly user ratings are highly persistent (coefficient on last week's rating 0.58 to 0.84). Practical reading: early ratings and sequel status matter for the first two weeks; afterwards screens and holidays dominate.

**Moul (2007).** Abstract: about 10% of the variation in consumer expectations comes from word of mouth; "information appears to affect consumer behavior quickly, with the length of a movie's run mattering more than the number of prior admissions".

**Liu (2006), "Word of Mouth for Movies: Its Dynamics and Impact on Box Office Revenue", Journal of Marketing 70(3):74-89.** Abstract and secondary only (no open copy found). Yahoo! Movies message boards: the volume of word of mouth, not its valence, explains box office, mainly in the weeks right after release; word of mouth is most active before release and in the opening week.

**Neelamegham and Chintagunta (1999), "A Bayesian Model to Forecast New Product Performance in Domestic and International Markets", Marketing Science 18(2):115-136.** Abstract (Crossref). Bayesian model that updates first-week viewership forecasts as information arrives, across markets. The method template for "prior from similar films, updated by the opening".

**Elberse and Eliashberg (2003), Marketing Science 22(3):329-354.** Abstract (Crossref): film attributes and advertising mostly act on revenue through exhibitors' screen allocation; performance and screens drive each other. For Pulse: the operator's own screen and showtime decisions are part of the trajectory, so forecasts should condition on the planned programme.

**Gilchrist and Sands (2016).** Already in the library as abstract-only. A JPE reader copy and the author's Harvard copy were blocked to us again. Abstract: shocks to opening weekend viewership are "doubled over the following five weekends".

**Sawhney and Eliashberg (1996).** Abstract (already in the library): cumulative revenue often within 10% using two or three data points.

### Parameters for Pulse

| Parameter | Value | Range | Source | Confidence |
|---|---|---|---|---|
| Weekly fade of publicity and word of mouth (δ) | 0.3 | 0.2 to 0.5 | Dellarocas et al. 2004 p.18 | medium |
| Same-day effect of a 10% rise in buzz volume on admissions | +6.3% | +3.3% to +6.3% (OLS to 3SLS) | Duan, Gu and Whinston Table 5 | medium (US) |
| Lagged effect, day +1 and day +2 | +1.7%, +1.0% | | Duan et al. p.18 | medium |
| Weekend day vs weekday admissions, same film | ×1.88 | ×1.62 to ×2.75 | Duan et al. p.20 (log coefficients 0.88 to 1.01) | medium |
| Extra later-weekend viewers per extra opening viewer (exogenous shock) | 1.0 over five weekends | 0.8 to 1.0 | Gilchrist and Sands abstract | low |
| Share of word-of-mouth driven variation | 0.10 | | Moul 2007 abstract | low |
| Sequel lift lasts | weeks 1 and 2 only | | Moon et al. Table 3 (p.115) | medium |

### Methods worth implementing

- **Discounted Bass trajectory update** (section 11.2). Before release, p and q come from the genre and legs priors in `priors.json` (and the hype index). After the first weekend, fit p and q to the operator's admissions (pooled across its venues) with the genre prior as a penalty, then forecast weeks 2 to 6. This replaces the surprise-tercile decay with a continuous, explainable update.
- **Pace by day, not by week**: Duan et al. show buzz acts within one to three days, so a film's pace index should be refreshed daily during its first ten days.

---

## 3. Occasions and group behaviour

### Findings

**Competition Commission (2013).** Read. Figure 7 (p.15, Read (figure)), "Did you visit the cinema ..." on the last visit:

| Companion | Cineworld (multiplex) | Picturehouse (arthouse) |
|---|---|---|
| As a couple | 40% | 50% |
| As a family | 31% | 8% |
| With friends | 21% | 26% |
| Alone | 7% | 15% |
| With someone else | 2% | 1% |

- Figure 8 (p.16, Read (figure)): day of last visit, Cineworld / Picturehouse: Monday 5 / 6%, Tuesday 9 / 9%, Wednesday 8 / 10%, Thursday 8 / 12%, Friday 11 / 10%, Saturday 28 / 19%, Sunday 14 / 12%, cannot remember 17 / 22%. Text (p.16): 50% of Cineworld and 40% of Picturehouse customers who recalled the day went at the weekend.
- Derived day index (recalled visits only, mean day = 1.0), Cineworld: Mon 0.42, Tue 0.76, Wed 0.67, Thu 0.67, Fri 0.93, Sat 2.36, Sun 1.18. Picturehouse: Mon 0.54, Tue 0.81, Wed 0.90, Thu 1.08, Fri 0.90, Sat 1.71, Sun 1.08.
- Caveats: last-visit recall by customers (not an admissions count), 2013, members and registered customers over-represented.

**CNC (2026).** Read. p.5 and chart p.10, "mode de fréquentation" of the last visit, France, 15+:

| | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|
| Alone | 22.9% | 20.3% | 21.3% | 23.5% | 19.2% |
| As a couple | 33.4% | 34.7% | 34.1% | 32.5% | 32.3% |
| As a family | 26.6% | 27.4% | 27.2% | 29.3% | 33.8% |
| With friends or colleagues | 17.1% | 17.6% | 17.4% | 14.7% | 14.8% |

- p.9: 15 to 19 year olds go alone least (12.8%) and with friends most (30.7%); seniors go as a couple most (42.9%); people who go at least weekly ("assidus") go alone a third of the time (33.3%); occasional cinemagoers are accompanied 88.2% of the time.
- p.10: 57.9% took the decision to go themselves; 20.6% decided jointly; 51.5% chose the film alone and 27.4% jointly.
- p.24 (table): time of the session at the last visit, 2026: morning 5.1%, afternoon (13:00 to 19:00) 53.4%, early evening (19:00 to 21:00) 31.8%, late (after 21:00) 8.9%. Seniors 59.7% afternoon; 15 to 24 year olds 47.4% evening. Note that French programming differs from UK programming.
- p.34: during the Fête du cinéma (all tickets €5 for four days) couples were 35.0% and solo visitors 23.5%, both above normal.

**One Day Independent Research (April 2026), "Cinema visit drivers".** Secondary (agency web page, https://oneday.agency/research/cinema-visit-drivers). 1,000 UK cinemagoers aged 18 to 55, multi-select: usually go with a partner 58%, family or children 40%, friends 30%, alone 22%. Low quality (no method published), but the only 2026 UK figure.

**Blom, Pendavingh and Spieksma (2020), "Filling a theatre in times of corona", arXiv:2010.01981.** Read (https://arxiv.org/pdf/2010.01981). p.18: historical reservations at a Dutch concert venue (Muziekgebouw Eindhoven) by party size: 1 seat 18%, 2 seats 70%, 3 seats 6%, 4 seats 6%. A booking-level (not person-level) distribution from live events.

**DCM and REDC (October 2025), "Cinema: A Family Favourite".** Read (https://www.dcm.co.uk/uploads/documents/Cinema_-_A_Family_Favourite_%28DCM_x_REDC%29.pdf). Online survey, September 2025, about 1,300 UK parents of 6 to 15 year olds. p.8: share of cinemagoing families "very or somewhat likely" to go to the cinema in October half-term 89%, Christmas holidays 86%, February half-term 87%, Easter 85%, May half-term 84%; cinema is the top choice in each. Stated intent, not attendance. p.5: cinemagoing families have higher incomes (average £80,400) and are more urban (56%) than non-cinemagoing families.

**DCMS Participation Survey 2024/25 (England).** Read (main report, https://www.gov.uk/government/statistics/participation-survey-2024-25-annual-publication/main-report-for-the-participation-survey-april-2024-to-march-2025, OGL v3.0). Figure 2.4: 54% of adults attended "a cinema screening of a film or movie" in the last 12 months, the second most common arts activity. The main report has no companion or party-size question; the survey does not ask who people went with.

**Not found:** an open UK source on party size by time slot or BBFC certificate, or on the family share in school holidays. CAA FAME, Pearl & Dean and DCM's audience panels are proprietary. BFI's yearbook has age profiles only.

### Parameters for Pulse

| Parameter | Value | Range | Source | Confidence |
|---|---|---|---|---|
| Companion mix, UK multiplex (couple, family, friends, alone, other) | 0.40, 0.31, 0.21, 0.07, 0.02 | | CC 2013 Fig. 7 | high (UK, 2013) |
| Companion mix, UK arthouse or independent | 0.50, 0.08, 0.26, 0.15, 0.01 | | CC 2013 Fig. 7 | high |
| Companion mix, France 2026 (alone, couple, family, friends) | 0.19, 0.32, 0.34, 0.15 | | CNC 2026 p.10 | medium for UK |
| Solo share of visitors | 0.07 multiplex, 0.15 arthouse | 0.07 to 0.23 | CC 2013; CNC 0.19; One Day 0.22 (multi-select) | high |
| Solo share among weekly-or-more cinemagoers | 0.33 | | CNC 2026 p.9 | medium |
| Solo share, teenagers 15 to 19 | 0.13 | | CNC 2026 p.9 | medium |
| Party size per booking, multiplex (1, 2, 3, 4, 5+) | 0.16, 0.57, 0.12, 0.105, 0.045 | ±0.05 each | Derived from CC 2013 (see note) | low |
| Mean party size per booking | 2.2 | 1.98 to 2.5 | Derived (CC 2013; CNC 2026 gives 1.98; Dutch venue 1.98) | medium |
| Day-of-week index, multiplex (Mon to Sun) | 0.42, 0.76, 0.67, 0.67, 0.93, 2.36, 1.18 | | Derived from CC 2013 Fig. 8 | medium (UK, recall) |
| Day-of-week index, arthouse (Mon to Sun) | 0.54, 0.81, 0.90, 1.08, 0.90, 1.71, 1.08 | | Derived from CC 2013 Fig. 8 | medium |
| Session time mix, France (morning, afternoon, early evening, late) | 0.05, 0.54, 0.32, 0.09 | | CNC 2026 p.24 | low for UK |
| Family share of daytime admissions, school holidays | 0.45 | 0.30 to 0.60 | Assumption (CC multiplex family share 0.31 on all visits; DCM 84 to 89% intent) | low |
| Family share multiplier by certificate (U, PG, 12A, 15, 18) | 1.6, 1.5, 0.9, 0.2, 0.0 | | Assumption | low |
| Adults in England attending a cinema in last 12 months | 0.54 | | DCMS Participation Survey 2024/25 | high |

Note on the derived party-size row: the CC shares are per respondent (a person), so a group of size k is counted once per respondent. Assuming couples are 2, families average 3.35 (2: 20%, 3: 35%, 4: 35%, 5+: 10%) and friends groups average 3.15 (2: 35%, 3: 30%, 4: 20%, 5+: 15%), the group-level shares for Cineworld are alone 0.158, couple and "someone else" 0.473, family 0.21 and friends 0.158, which gives the size distribution above and a mean of 2.25 people per party. The family and friends size splits are assumptions; Seatfold's own bookings will replace them within weeks.

### Methods worth implementing

- **Occasion as a latent class** on each booking (solo, couple, family, friends) from observable signals: number of tickets, child or concession tickets, certificate, slot. Pulse then forecasts admissions as parties × party size, which matters for seat blocks, food baskets and staffing.
- **Day-of-week prior from CC 2013** in place of the flat prior for venues with no history, shrunk to the venue's own pattern as data arrives (empirical Bayes, as in `pulse-data-sources.md` 4.4).

---

## 4. Decision timing and booking curves

### Findings

**CNC (2026).** Read.
- p.13 (chart): when the decision to go was taken, 2022 to 2026. 2026: same day 27.6%, the day before 33.5%, several days ahead 38.9%. 2019: 68.5% decided the day before or earlier. Occasional cinemagoers plan most (78.7% ahead, 50.1% several days ahead); weekly-or-more cinemagoers decide on the day most (35.6%).
- p.11 to 12: 41.7% booked in advance in 2026 (35.3% in 2025, 25.6% in 2019, 14.4% in 2016). Table p.12: did not book although possible 35.0%; booking not possible 8.7%; did not know 10.4%; ticket given 4.1%. 25 to 34 year olds book most (59.1%), seniors least (28.6%).
- p.12 (chart): among those who booked, timing in 2026: several days ahead 20.1%, the day before 34.9%, the same day 45.0%. Reasons for booking: to be sure of a seat at the chosen show 59.7%, to avoid queues 43.9%, to choose a seat 22.4%. 46.4% of bookers used a phone app, 40.9% a computer, 11.0% the box office in advance.
- Derived share of all admissions sold before the day: 0.417 × 0.201 = 8.4% several days ahead; plus 0.417 × 0.349 = 14.6% the day before, so about 23% of tickets are bought before the day of the show in France. UK online booking is more common in multiplexes, so treat this as a lower bound.

**Price, Perry, Mantell, Trinder and Pitts (2019), "Spontaneity and planning in arts attendance: insights from qualitative interviews and the Audience Finder database", Cultural Trends 28(2-3):220-238.** Read (CC BY, https://eprints.whiterose.ac.uk/147759/1/08_07_2019_Spontaneit.pdf). UK, Audience Finder ticketing data plus interviews.
- p.10: "Cinema trips were the second most spontaneous arts event, with participants commonly choosing to go to the cinema a matter of hours before the start of the film"; rising prices push some to plan; one-off screenings and opening nights need advance booking; spontaneous cinema-going is seasonal ("dark winter evenings").
- p.10 (Figure 2): with three months to go, 47% of £30+ tickets were sold against 9% of tickets under £5; 52% of same-day sales were under £10 a ticket.
- p.13 (Figure 4): "larger party sizes booking earlier. Attenders who bought one or two tickets were consistently the latest bookers".
- p.9: 87% of rock and pop tickets were sold a fortnight ahead, against 47% for experimental theatre. On-the-day tickets are mostly bought in person (p.8).

**Competition Commission (2013).** p.23: 66% of multiplex customers knew which day they wanted to go before choosing the film. Days are often fixed by the occasion; the film fills the slot.

**Other:** a 2017 US YouGov poll (Statista summary, Secondary) had 37% of 18 to 24 year olds buying on the day. A Chinese ticketing executive (Hollywood Reporter interview, Secondary) put advance online booking at about 15% for an average film, higher for blockbusters. No open cinema booking-curve dataset by hour was found.

### Parameters for Pulse

| Parameter | Value | Range | Source | Confidence |
|---|---|---|---|---|
| Decision taken on the day | 0.28 | 0.27 to 0.30 | CNC 2026 p.13 | medium (France) |
| Decision the day before | 0.34 | 0.33 to 0.35 | CNC 2026 p.13 | medium |
| Decision several days ahead | 0.39 | 0.35 to 0.39 | CNC 2026 p.13 | medium |
| Share of admissions booked in advance | 0.42 | 0.26 (2019) to 0.42 | CNC 2026 p.11 | medium; UK likely higher |
| Of advance bookers: several days / day before / same day | 0.20, 0.35, 0.45 | | CNC 2026 p.12 | medium |
| Share of tickets sold before the day of the show | 0.23 | 0.15 to 0.40 | Derived from CNC | low for UK |
| Same-day decision, weekly-or-more cinemagoers | 0.36 | | CNC 2026 p.13 | medium |
| Several-days-ahead decision, occasional cinemagoers | 0.50 | | CNC 2026 p.13 | medium |
| Booking lead time by party size | larger parties earlier; 1 to 2 tickets latest | | Price et al. 2019 p.13 | medium (UK, arts, direction only) |
| Booking lead time by price | dearer tickets earlier | | Price et al. 2019 p.10 | medium (direction only) |

### Methods worth implementing

- **Booking curve by party size and occasion**: split the pace curve into "planned" (families, groups of 3+, premium formats, event cinema, opening nights) and "spontaneous" (1 to 2 tickets, weekday evenings, holdovers). Fit the mixture weight per slot. This explains why an opening Friday looks "ahead of pace" early and a Tuesday evening looks "behind" until the afternoon.
- **Keep the additive pickup** from `pulse-data-sources.md` 4.3; use the CNC split only to shape the prior curve before 20 shows of history exist.

---

## 5. Price sensitivity

### Findings

The figures below measure different things. The level matters more than the study.

**Market level (everyone, all cinemas):**
- Dessy and Gambaro (2008), DEMM working paper 2008-025, 15 European countries, 1989 to 2003. Secondary (search summary of the abstract; PDF link returned an empty file): price elasticity −0.26, "quite inelastic".
- Competition Commission (2013), Figure 21 p.29 (Read): after a 5% price rise at one operator, only 3% (Cineworld) and 1% (Picturehouse) of admissions would have left cinema-going. Derived market-level stated elasticity −0.6 and −0.2.
- Dewenter and Westermann (2005), Germany 1950 to 2002: −2.40 to −2.47 (Secondary, via Kaymaz 2021 p.4, https://dergipark.org.tr/tr/download/article-file/947966). Long-run time series, partly a television-era effect; treat as an outer bound.
- Fernández-Blanco and Baños-Pino (1997), Spain 1968 to 1992: "elastic" (Secondary, Kaymaz p.3).

**Operator or venue level (one chain changes price, rivals do not):**
- CC 2013 Figure 21 (Read): Cineworld would lose 36% of admissions after a 5% rise (25% to other operators, 6% to Picturehouse, 3% to other Cineworld sites, 3% not going); Picturehouse 8%. Derived stated elasticities −7.2 and −1.6. Stated preference overstates switching, but the gap between multiplex and arthouse is the useful part: arthouse members are far less price-sensitive.

**Film or show level (one film or one show inside the market):**
- Ho, Liang, Weinberg and Yan (2018), JMR 55:414-431, Hong Kong nested logit: product elasticity 5 to 6.5 (Secondary, via Ho, Rysman and Wang 2020 p.38).
- Ho, Rysman and Wang (2020) p.39 (Read): calibrate to a product elasticity of 4.
- de Roos and McKenzie (2014), Sydney discount Tuesdays: about 2.5, described as a market elasticity (Secondary, via Ho, Rysman and Wang p.38). Abstract: the discount Tuesday expands the market.

**Discount days and events:**
- UK National Cinema Day, Saturday 3 September 2022, £3 tickets at 550 to 600 venues: just over 1.46 million admissions (Comscore via Cinema First press release; Secondary), described in later press as about three times a normal day (Secondary). Derived single-day arc elasticity, assuming a normal average price of about £7.50: ln(3) / ln(3/7.5) ≈ −1.2. It includes pull-forward from other days and publicity, so it overstates the lasting effect.
- Fête du cinéma 2026 (France, €5 for four days): 31.5% of respondents went; 51.5% of them saw films they would not otherwise have seen; average 2.0 films each (CNC 2026 p.33, Read).
- Orange Wednesdays (UK, 2004 to 2015): used by 37% of people who had been to the cinema in the previous six months (YouGov SixthSense, 2,152 UK adults, September 2010; Secondary via seenit.co.uk). Before the offer, Wednesday was 9% of 2002 admissions (Marketing Week 2003, Secondary). No open estimate of the offer's net effect was found.

**Uniform pricing and backlash:**
- Orbach and Einav (2007), International Review of Law and Economics 27(2). Read (working paper version, http://web.stanford.edu/~leinav/pubs/IRLE2007.pdf). p.8: anecdotes of profitable deviations (Washington DC weekday cuts of 67% more than doubled popcorn sales; Japanese premiums of 67%; Czech premiums of 30 to 50%). p.20: exhibitors' mark-up is about 85% on refreshments and about 45% on tickets (citing Hofmann 2003), so exhibitors gain more from an extra admission than the ticket price suggests.
- UK Odeon "dynamic pricing" from 2014 and later blockbuster surcharges drew local protests (for example Llanelli, where Odeon cut prices by almost half after complaints) but became "normalised" (Secondary, press). No open study measured demand loss from the backlash.
- Yi, Kim and Chung (2024), Review of Industrial Organization 64(3). Abstract (https://ideas.repec.org/a/kap/revind/v64y2024i3d10.1007_s11151-024-09944-2.html): a Korean chain's prime, standard and economy seat zones (March 2016) raised revenue by 10.6% with no change in tickets sold; nearby competing shows slightly reduced the gain.

**Memberships and subscriptions:**
- CC 2013 p.28 (Read): free member entries were 13% (Cineworld) and 16% (Picturehouse) of admissions; 58% of Picturehouse customers and 8% of Cineworld customers in the sample were members (p.1). A 5% fee rise would keep 91% (Picturehouse) and 70% (Cineworld) of member admissions (p.3).
- AMC Entertainment 10-K for 2024 (Read via WebFetch, https://www.sec.gov/Archives/edgar/data/1411579/000141157925000042/amc-20241231x10k.htm): Stubs members were about 49% of US attendance; A-List allows up to three films a week.
- CNC 2026 p.23 to 24 (Read): 11.4% chose their cinema because they hold an unlimited card.
- MoviePass (2016, company-commissioned, Secondary via Variety): +111% attendance in two test markets (monthly visits 1.56 to 3.12 and 1.58 to 3.54), no control group. No independent causal study of unlimited cards was found.

### Parameters for Pulse

| Parameter | Value | Range | Source | Confidence |
|---|---|---|---|---|
| Market elasticity (all cinemas move together) | −0.4 | −0.2 to −1.0 | Dessy and Gambaro; CC 2013 (derived) | medium |
| Venue or operator elasticity, multiplex (rivals unchanged) | −2.0 | −1.0 to −7.0 (stated) | CC 2013 Fig. 21 (derived, stated preference) | low |
| Venue or operator elasticity, arthouse with members | −0.8 | −0.3 to −1.6 | CC 2013 Fig. 21 (derived) | low |
| One show's own-price elasticity (other shows unchanged) | −2.0 | −1.2 to −4.0 | Ho et al. (4 to 6.5 at film level), de Roos and McKenzie (2.5) | low |
| `priceElasticity` in `choice.ts` if the nest already reallocates demand | −0.7 | −0.4 to −1.0 | Market level, above | medium |
| Single-day blanket discount response (×admissions at 40% of usual price) | ×3 | ×2 to ×3.5 | National Cinema Day 2022 (Secondary) | low |
| Seat-zone pricing revenue gain | +10.6% | +5% to +11% | Yi, Kim and Chung 2024 abstract | low (Korea) |
| Exhibitor margin, concessions vs tickets | 0.85 vs 0.45 | | Orbach and Einav p.20 (citing Hofmann) | low (US, dated) |
| Member admissions retained after a 5% fee rise | 0.70 multiplex, 0.91 arthouse | | CC 2013 p.3 | medium (stated) |
| Member share of admissions | 0.13 to 0.16 (UK 2013); 0.49 loyalty (US 2024) | | CC 2013 p.28; AMC 10-K | medium |

### Methods worth implementing

- **de Roos and McKenzie's identification idea** with each operator's own discount nights: the gap between discount and full-price nights, controlling for film and week, is the operator's own elasticity. With the nested model, the same data identify how much of the discount night's crowd came from other nights (pull-forward) and how much was new.
- **A stated-diversion question** (CC 2013 style) on the post-visit survey gives a cheap check on the elasticity Pulse uses for pricing suggestions.

---

## 6. Seat choice

### Findings

No open, peer-reviewed study of real cinema seat-choice logs was found. What exists:

- **Christenfeld (1995), "Choices from identical options", Psychological Science 6(1).** Secondary (summaries): with four identical positions, 71% of supermarket picks came from the middle two rows; 60% of toilet roll use came from the middle two of four stalls. A replication (Nakajima et al., Kwansei Gakuin) found a right-side bias rather than a centre bias.
- **Weyers, Milnik, Müller and Pauli (2006), "How to choose a seat in theatres: always sit on the right side?", Laterality 11:181-193.** Secondary: a rightward preference on standard seating charts (screen at the top), which disappears with other chart orientations. Okubo (2010, Secondary): right-handed participants (N = 269) chose seats to the right when keen on the film.
- **Harms, Reese and Elias (2014), "Lateral bias in theatre-seat choice", Laterality.** Title and metadata only (Crossref, Semantic Scholar). Described in a search summary as looking at real seat choice in a Saskatoon cinema; we could not read it.
- **Theoretical seat pricing** (Journal of Business Research 2026, "Optimal ticket pricing by seat location in the movie industry", Abstract via search summary): only central seats in back rows command a willingness to pay premium.
- **Morning Consult (March 2023, US, via Statista, Secondary)**: 20 to 33% prefer the back third of the auditorium, highest among millennials.
- **PopcornData (Singapore, January 2020)**: a student project that scraped Shaw Theatres seat maps with purchase timestamps and published heat maps and buy-order animations (https://github.com/PopcornData/popcorn-data-website). Write-ups were blocked to us; no licence is stated. Useful only as proof that seat-order data answers this question.
- **Blom, Pendavingh and Spieksma (2020)**: seat-block geometry for parties (Read), not preferences.
- **Korea zone pricing** (section 5): prime zones can carry a premium without losing tickets.

### Parameters for Pulse

| Parameter | Value | Range | Source | Confidence |
|---|---|---|---|---|
| Share choosing the middle half of a row when free | 0.65 | 0.60 to 0.71 | Christenfeld 1995 (Secondary) | low |
| Lateral (left/right) preference | 0 | small rightward bias possible | Weyers 2006, Okubo 2010 (Secondary) | low |
| Preferred depth (share of auditorium depth from the screen) | 0.65 | 0.55 to 0.75 | Assumption, consistent with "centre seats in back rows" | low |
| Parties seated contiguously | 1.0 | | Structural | high |
| Gap left between unrelated parties when the show is under half full | 1 seat | 0 to 2 | Assumption | low |

### Methods worth implementing

- **Conditional logit over available seats, fitted on Seatfold's own booking order** (McFadden-style; every booking is a choice among the seats free at that moment). Seat utility = row depth term + centre distance term + aisle term + distance to the nearest other party + premium zone. Fit per auditorium layout family. This gives "which seats sell first" for zone pricing and for a fill-order forecast, and it is a dataset competitors without the seat map cannot build.
- **Fill-order simulation**: once the seat model exists, simulate a show filling from the party-size distribution (section 3) to estimate stranded single seats and how many tickets a layout really sells at "sold out".

---

## 7. External drivers

### Findings

**Weather.**
- Chen, Xie, Chen and He (2023), "Weather shocks and movie recreation demand in China", Energy Economics 127. Read (https://ccap.pku.edu.cn/docs/2024-01/20240105105618405277.pdf). 49 cities, 2015 to 2017, city-day data with city, day and film fixed effects. p.2 and p.6: against 20 to 25 °C, extreme heat cuts audiences by 3.38% (revenue 5.61%); extreme cold below −5 °C cuts audiences by 7.87% (revenue 13.51%). The abstract defines heat as a daily mean above 25 °C; the body (p.6) describes significant effects below −5 °C and above 30 °C, with moderate temperatures mostly insignificant. Rain (p.6): light rain −1.45%, moderate a further −0.92%, heavy −3.49%, torrential −4.62% against no rain.
- Izquierdo Sanchez, Elliott and Simmons (2016), "Substitution between leisure activities: a quasi-natural experiment using sports viewing and cinema attendance", Applied Economics 48. Read (accepted version, https://ueaeprints.uea.ac.uk/id/eprint/57258/1/filmsportspaperDecember2015_2rr.pdf). Weekly per-capita box office, Spain, UK, Finland and Belgium, 2007 to 2012. Table 4 (p.26): weekly average maximum temperature −0.012 per °C (s.e. 0.002) on per-capita revenue; Table 1 (p.22) means are 0.80 to 1.26, so roughly −1% per °C (Derived). The model has country and year effects but no week-of-year effects, so this is partly seasonal.
- Choi, Boatwright and Smith (2015), "The Perfect Storm", CMU working paper. Read in part (https://www.cmu.edu/entertainment-analytics/documents/technology-impact-on-entertainment/the-perfect-storm.pdf): major US snowstorms reduce theatrical attendance (used as an instrument; p.4, p.16).
- Gilchrist and Sands (2016) and Moretti (2011) are already in the library: weather moves openings, and openings carry into later weeks.
- UK: One Day (2026, Secondary) reports 82% of respondents link cinema visits to poor weather (stated). No measured UK effect was found.

**Major sports events.**
- Izquierdo Sanchez et al. (2016), p.14 to 15, Table 4: box office falls about 15% per capita during major international football tournaments (Spain and UK treated, Finland and Belgium controls); about 18% with Spain alone treated. DD coefficients −0.250 and −0.295 (p.26).
- UK trade press (Secondary): 2006 World Cup afternoon and evening kick-offs coincided with a 5% dip in UK admissions (UK Film Council data via filmdetail.com); on the Euro 2020 men's final day UK box office was £1.7m against £4.4m on the equivalent 2019 day (Screen Daily, confounded by Covid).

**Daylight and clocks.** No cinema study found. Price et al. (2019, p.10) record that spontaneous cinema-going is "an activity reserved for dark winter evenings" for some interviewees. Card-spending studies of the US clock change (JPMorgan Chase Institute) were seen only in press summaries with conflicting figures. Keep the computed-sunset covariate in `pulse-data-sources.md` and let operator data size it.

**Payday.** Stephens (2006), "Paycheque receipt and the timing of consumption", Economic Journal 116(513):680-701. Abstract: UK household spending is "excessively sensitive" to paycheque arrival, mainly among liquidity-constrained households. No cinema-specific estimate. A payday flag (last working day of the month, and the following Friday and Saturday) is a reasonable covariate to test, not a prior to ship.

**School terms.** DCM 2025 (Read, stated intent) shows cinema is the first-choice family activity in every half-term and holiday (84 to 89% likely). Monthly UK seasonality is already in `priors.json`.

### Parameters for Pulse

| Parameter | Value | Range | Source | Confidence |
|---|---|---|---|---|
| Major football tournament weeks (home nation playing) | ×0.85 | ×0.82 to ×0.95 | Izquierdo Sanchez et al. 2016 | medium (UK in sample) |
| Overlapping slot on a home-nation match day | ×0.6 | ×0.4 to ×0.95 | Assumption, informed by Euro 2020 final day and trade reports | low |
| Weekly maximum temperature | −1% per °C | −0.5% to −1.5% | Izquierdo Sanchez et al. Table 4 (derived) | low |
| Extreme heat (daily mean above 25 °C, rare in UK) | ×0.97 | ×0.94 to ×1.0 | Chen et al. 2023 | low for UK |
| Extreme cold (below −5 °C) or snow | ×0.92 | ×0.85 to ×0.97 | Chen et al. 2023; Choi et al. 2015 | low |
| Light rain / heavy rain | ×0.99 / ×0.97 | ×0.95 to ×1.05 | Chen et al. 2023 (China); UK sign unknown | low |
| Payday weekend | ×1.0 (test, do not ship) | ×1.0 to ×1.05 | Stephens 2006 abstract (direction only) | low |

### Methods worth implementing

- **Residual backtest before any weather feature**, as `pulse-data-sources.md` 2.4 already recommends: regress log(actual ÷ forecast) on temperature anomaly (against the venue's own month normal), rain bins (Chen et al.'s 0.1, 10, 25, 50 mm cut-offs) and match-day flags. Ship only the terms that survive.
- **Event calendar with kick-off times**: the effect is concentrated in shows that overlap a home-nation match, not the whole day.

---

## 8. Habit and churn

### Findings

**CNC (2025), "Le public du cinéma en 2024".** Read (https://www.cnc.fr/documents/36995/2328824/Le+public+du+cin%C3%A9ma+en+2024.pdf; same reuse notice). France, 3+.
- p.6 (chart) and p.8: weekly-or-more cinemagoers ("assidus") are 3.3% of cinemagoers and make 24.2% of admissions at 31.6 visits a year; monthly-or-more ("réguliers") are 24.6% and make 46.6%; less than monthly ("occasionnels") are 72.1% and make 29.2%.
- Derived visits a year: réguliers 0.466 × 181.5m ÷ 10.3m = 8.2; occasionnels 0.292 × 181.5m ÷ 30.2m = 1.75. Mean gaps: about 12, 45 and 210 days.
- p.7: 64.9% of people aged 3+ went at least once; 4.3 visits per cinemagoer; seniors 5.7.

**MPAA (2017), "Theatrical Market Statistics 2016".** Read (https://www.motionpictures.org/wp-content/uploads/2017/03/2016-Theatrical-Market-Statistics-Report-2.pdf). p.13: 11% of the US and Canada population are frequent cinemagoers (once a month or more) and buy 48% of tickets; occasional cinemagoers buy 50%, infrequent 2%.

**Competition Commission (2013).** Read. Table 4 (p.11): visits to the surveyed cinema in the last six months. Typical Cineworld site: 1 to 2 visits 41 to 57%, 3 to 4 29 to 38%, 5 to 6 11 to 18%, 7 to 12 2 to 6%, more than 12 0 to 4%; average 3.5 (Cineworld) and 4.3 (Picturehouse) per six months among these registered customers (p.10).

**CNC (2026)** p.23: the share always using the same cinema fell to 70% in 2026; seniors are least loyal to one site.

**Fader, Hardie and Lee (2005), "Counting your customers the easy way: an alternative to the Pareto/NBD model", Marketing Science 24(2):275-284.** Read (http://www.brucehardie.com/papers/018/fader_et_al_mksc_05.pdf). The BG/NBD likelihood is closed form (gamma-distributed purchase rates, beta-distributed drop-out after each purchase) and needs only frequency, recency and length of observation per customer.

**Not found:** an open study of what predicts lapsing for cinema members specifically, or of loyalty programme causal effects. AMC's 10-K describes member share, not effects.

### Parameters for Pulse

| Parameter | Value | Range | Source | Confidence |
|---|---|---|---|---|
| Share of cinemagoers weekly or more / monthly or more / less often | 0.033, 0.246, 0.721 | | CNC 2025 p.6 | medium (France) |
| Their share of admissions | 0.242, 0.466, 0.292 | | CNC 2025 p.6 | medium |
| Visits a year by segment | 31.6, 8.2, 1.75 | | CNC 2025 p.8; derived | medium |
| Typical gap between visits by segment (days) | 12, 45, 210 | | Derived | medium |
| Share of tickets bought by people going monthly or more | 0.48 to 0.71 | | MPAA 2016 p.13 (US); CNC (France) | medium |
| Visits to one UK site per six months, registered customers | 3.5 multiplex, 4.3 arthouse | 2.3 to 5.3 by site | CC 2013 Table 4 | high (UK) |
| Adults attending at least once a year | 0.54 (England), 0.649 (France 3+) | | DCMS 2024/25; CNC 2025 | high |
| Churn-risk ratio threshold (days since last ÷ own median gap) | 2.0 | 1.5 to 3.0 | Current Pulse rule; no external evidence | low |

### Methods worth implementing

- **BG/NBD** (section 11.3) for "probability still active" and expected visits in the next 90 days per member, replacing the single ratio rule. It handles the very different gaps of weekly and occasional cinemagoers, which a fixed ratio does not.
- **Segment tiles by visit frequency** using the CNC bands (weekly, monthly, less than monthly) so operators can compare their base with a published national shape.

---

## 9. Concessions

### Findings

**Competition Commission (2013).** Read. Figure 12 (p.19, Read (figure)), food and drink bought for oneself on the last visit, Cineworld / Picturehouse: snacks 37 / 25%, soft drink 30 / 17%, hot drink 4 / 17%, alcoholic drink 2 / 33%, meal 1 / 4%, nothing 49 / 31%. Figure 13 (p.20): average spend for oneself £3.38 / £3.84 including those who bought nothing. Figure 14 (p.21): site averages £2.56 (Cambridge Cineworld) to £5.19 (Bury St Edmunds Picturehouse). Figure 19 (p.26): about two thirds of Cineworld customers said food and drink had no influence on their choice of cinema.

**CNC (2026)** p.9: 38.3% bought popcorn on their last visit; 53.7% of 15 to 24 year olds.

**AMC Entertainment, Q4 2024 results exhibit (8-K, 25 February 2025).** Read via WebFetch (https://investor.amctheatres.com/sec-filings/all-sec-filings/content/0001411579-25-000037/amc-20250225xex99d1.htm), "Segment Other Data" table: 2024 food and beverage per patron US $8.30 (2023 $7.95), International $4.80 ($4.60); average ticket price US $12.22, International $9.57. AMC International includes Odeon in the UK. Derived food-to-ticket ratio 0.68 (US) and 0.50 (International).

**Everyman (2019 results).** Secondary (search summary of the RNS): average ticket price £11.37, food and drink spend per head £7.13 (ratio 0.63). `pulse-data-sources.md` 3.5 already notes FY2025 £11.32 against £12.51.

**Vista Group (May 2023), "The impact of concession discounts on moviegoer spend".** Read (https://vista.co/insights/the-impact-of-concession-discounts-on-moviegoer-spend). Randomised trial, 28,000+ cinemagoers at two US exhibitors, November 2021 to March 2022, targeted at the lowest-spending quarter: large popcorn attach in control groups 10.1% and 9.3%; $1 to $4 popcorn discounts raised total spend per admission by 2.1% to 17.6% (average 5.2% and 11.1% by exhibitor) and items per admission by 37 to 44%. Vendor research with no significance tests.

**Gil and Hartmann (2009).** Abstract (Crossref): people who value admission more buy more concessions, so high concession prices extract more from them. Working paper copy not reachable.

**Not found:** an open breakdown of basket composition by party type or by time of day.

### Parameters for Pulse

| Parameter | Value | Range | Source | Confidence |
|---|---|---|---|---|
| Share of customers buying any food or drink for themselves, multiplex | 0.51 | 0.45 to 0.60 | CC 2013 Fig. 12 | high (UK, 2013) |
| Same, arthouse | 0.69 | 0.60 to 0.75 | CC 2013 Fig. 12 | high |
| Basket mix, multiplex (snacks, soft drink, hot drink, alcohol, meal) | 0.37, 0.30, 0.04, 0.02, 0.01 | | CC 2013 Fig. 12 | high |
| Basket mix, arthouse | 0.25, 0.17, 0.17, 0.33, 0.04 | | CC 2013 Fig. 12 | high |
| Popcorn purchase rate | 0.38 | 0.30 to 0.45 | CNC 2026 p.9 | medium |
| Popcorn rate, 15 to 24 year olds (friends groups) | 0.54 | | CNC 2026 p.9 | medium |
| Food and drink per head ÷ average ticket price | 0.55 | 0.45 to 0.70 | AMC 2024 (0.50 Intl, 0.68 US); Everyman 2019 (0.63) | medium |
| Attach-rate prior (Pulse's `food.ts` shrink target) | 0.45 multiplex, 0.65 arthouse or premium | 0.35 to 0.70 | CC 2013, replacing the 0.35 assumption | medium |
| Spend uplift from a targeted popcorn discount | +5% to +11% per admission | +2% to +18% | Vista 2023 | low |

### Methods worth implementing

- **Attach rate by occasion**: once occasions are inferred (section 3), model attach as a beta-binomial per occasion × slot, shrunk to the CC 2013 fascia figures. Teen and friends groups buy popcorn and soft drinks; couples at arthouse venues buy hot drinks and alcohol.
- **Bundle tests as experiments**: the Vista design (random assignment within a low-spend segment) is the right way to measure discount effects; Pulse can propose and evaluate them with the operator's approval.

---

## 10. Free datasets with behaviour parameters and their licences

| Dataset | What it gives Pulse | Licence | Verified? |
|---|---|---|---|
| Competition Commission (2013) Cineworld/City Screen survey report, GfK NOP | Companion mix, day of visit, journey time, mode of travel, food and drink, visit frequency, price and closure diversion for 25 UK cinemas | Published on GOV.UK; OGL v3.0 applies unless stated otherwise. The PDF has no licence line | Report read; licence by GOV.UK default |
| Other CMA and CC cinema merger inquiries (for example AMC/Odeon and UCI 2016, Vue, Cineworld/Picturehouse) | More survey evidence on diversion and catchments | Same GOV.UK default | Not opened this session |
| DCMS Participation Survey (2021 onwards) and Taking Part (2005 to 2020) | Cinema attendance by age, region, deprivation, disability; data tables and microdata (UK Data Service) | OGL v3.0 for publications and tables | Main report licence line read |
| CNC CinExpert studies ("Les pratiques cinématographiques des Français", "Le public du cinéma") | Companion mix, decision timing, booking, session times, frequency bands, popcorn | "Toute reproduction ... autorisée sous réserve de la mention : source CNC" (p.36) | Read |
| Price et al. (2019) Cultural Trends, Audience Finder analysis | UK arts booking lead time by price, party size, region | CC BY 4.0 | Read |
| Blom, Pendavingh and Spieksma (2020), arXiv | Party-size distribution of bookings at a Dutch venue | arXiv licence (figures are facts) | Read |
| Duan, Gu and Whinston (2008) accepted manuscript | WOM elasticities | CC BY-NC-ND 4.0 (manuscript); cite the figures only | Read |
| MPAA Theatrical Market Statistics | US frequency concentration | Copyright; quote with attribution | Read |
| ONS Living Costs and Food Survey, Family Spending tables | Household spending on cinema by household type and income | OGL v3.0 | Not opened this session; worth checking for spend by household composition |
| Met Office MIDAS Open, ERA5 | Weather backtest | OGL; CC BY 4.0 | Already in `pulse-data-sources.md` |
| openfootball | Match dates for the tournament flag | CC0 | Already in `pulse-data-sources.md` |

Not open, despite being the obvious sources: CAA FAME and Film Monitor, Pearl & Dean and DCM audience panels (DCM's public summaries are quotable), BFI audience research (BFI terms), UK Cinema Association data, Comscore.

---

## 11. Method papers to implement first

### 11.1 Einav (2007) nested logit for the night's choice

Why first: `choice.ts` already has the right shape (a two-level aggregator) but its `lambdaCross` and `lambdaFilm` are labelled working values "until the behaviour research lands". Einav gives a measured σ (0.52) for the "films versus not going" nest, the estimating equation is linear, and it can be refitted per operator with two-stage least squares on data Pulse already stores (show admissions, shows per session, film fixed effects). The CC 2013 closure diversion (8% and 25% leave the market) gives an independent check on how much demand an operator loses when it removes a show.

Steps: (1) set `lambdaCross` default to 0.5 and keep 0.75 as the upper sensitivity case; (2) fit `log(s_show) − log(s_outside) = film + slot + weekday + σ_film log(s_show | film) + σ_cross log(s_film | inside) + decay × week` per operator, with the number of other shows in the session and other films on release as instruments; (3) shrink each operator's σ towards 0.5 with the usual pseudo-count.

### 11.2 Discounted Bass update after the opening (Dellarocas et al. 2004/2007; Sawhney and Eliashberg 1996)

Why: operators' biggest question in week 1 is "how many screens next week". Pulse today picks one of three decay rates from the opening surprise. A two-parameter Bass model with a fixed weekly discount δ = 0.3 fits weekly revenue with R² near 0.98, its parameters are predictable from first-week signals, and it reads naturally as "publicity" and "word of mouth". With a prior on (p, q) from the genre legs in `priors.json` and the hype index, the update is a small penalised least-squares fit with no library. Sawhney and Eliashberg's exponential and Erlang-2 forms are the fallback for films with only two or three data points.

### 11.3 BG/NBD for lapsing (Fader, Hardie and Lee 2005)

Why: the loyalty module's churn rule (days since last visit ÷ own median gap ≥ 2) treats a weekly cinemagoer and a twice-a-year family the same way. CNC's frequency bands show gaps from about 12 to about 210 days. BG/NBD gives "probability still active" and expected visits from three numbers per member, the likelihood is closed form (four parameters, fitted once per operator by maximum likelihood with a simple optimiser) and the paper's appendix gives the formulas and a spreadsheet implementation.

Next in line: the seat-choice conditional logit on Seatfold's own seat maps (section 6), and Davis-style distance decay for catchments (section 1).

---

## 12. What we could not verify

- **Full texts blocked or not found:** Liu (2006), de Roos and McKenzie (2014), Gilchrist and Sands (2016, author copy denied), Gil and Hartmann (2009 working paper link), Ho, Liang, Weinberg and Yan (2018), Dessy and Gambaro (2008, empty PDF), Dewenter and Westermann (2005), Fernández-Blanco and Baños-Pino (1997), Harms et al. (2014), Weyers et al. (2006), Christenfeld (1995), Stephens (2006), Collins, Hand and Ryder (2005, "The lure of the multiplex?", Environment and Planning A, travel cost models; abstract summary only), Yi, Kim and Chung (2024). Their figures above are marked Abstract or Secondary.
- **Press and vendor figures:** National Cinema Day (1.46m admissions and "three times normal"), Orange Wednesdays usage and the Wednesday baseline, World Cup 2006 −5%, Euro 2020 final day, Everyman 2019, MoviePass +111%, Morning Consult seat preferences, One Day 2026 survey. All Secondary; none is used as a high-confidence prior.
- **Davis (2006):** we read the December 2001 working paper; the published coefficients may differ.
- **Dellarocas et al.:** the copy read is an unofficial mirror of the 2004 working paper; published 2007 numbers may differ.
- **CC 2013 licence:** GOV.UK default is OGL v3.0, but the PDF carries no licence line; ask the CMA if Seatfold wants to republish the charts.
- **UK-specific gaps:** no open UK data on party size by slot or certificate, family share in school holidays, booking curves by hour, seat-choice logs, concession baskets by party type, or weather effects. These are exactly the parameters Seatfold's own booking data will learn fastest; the values above are labelled as assumptions where they stand in.
- **Rate limits:** Semantic Scholar and OpenAlex APIs refused our requests (HTTP 429 and an exhausted shared budget), so the seat-choice literature search relied on web search only.

## Sources read in this session (new to the library)

- Einav (2007), RAND, http://web.stanford.edu/~leinav/pubs/RAND2007.pdf
- Orbach and Einav (2007), IRLE, http://web.stanford.edu/~leinav/pubs/IRLE2007.pdf
- Davis (2001), MIT working paper, http://web.mit.edu/pjdavis/www/papers/movies.pdf
- Competition Commission (2013), GfK NOP survey, https://assets.publishing.service.gov.uk/media/5329dde2e5274a2268000213/report.pdf
- CNC (2026), pratiques cinématographiques, https://www.cnc.fr/documents/36995/2526340/Les+pratiques+cin%C3%A9matographiques+des+Fran%C3%A7ais+en+2026.pdf
- CNC (2025), le public du cinéma en 2024, https://www.cnc.fr/documents/36995/2328824/Le+public+du+cin%C3%A9ma+en+2024.pdf
- Ho, Rysman and Wang (2020), https://conference.nber.org/conf_papers/f133054.pdf
- Dalton and Leung (2013), https://mpra.ub.uni-muenchen.de/52439/1/MPRA_paper_52439.pdf
- Chiou (2007), https://www.oxy.edu/sites/default/files/assets/Economics/Chiou/chiou_timing.pdf
- Duan, Gu and Whinston (2008), https://open.bu.edu/server/api/core/bitstreams/184a2ad3-5e93-46e2-a0d8-2ad522fb7cc4/content
- Dellarocas, Awad and Zhang (2004), https://fravia.deadbsd.org/ccs.mit.edu/dell/papers/movieratings.pdf
- Moon, Bergey and Iacobucci (2010), https://cdn.vanderbilt.edu/vu-web/owen/files/publications/MovieRatings-JM2010.pdf
- Eliashberg et al., "Decision Models for the Movie Industry" (handbook chapter), https://faculty.wharton.upenn.edu/wp-content/uploads/2013/03/Eliashberg---Decision-models-movie-industry.pdf
- Chen, Xie, Chen and He (2023), https://ccap.pku.edu.cn/docs/2024-01/20240105105618405277.pdf
- Izquierdo Sanchez, Elliott and Simmons (2016), https://ueaeprints.uea.ac.uk/id/eprint/57258/1/filmsportspaperDecember2015_2rr.pdf
- Choi, Boatwright and Smith (2015), https://www.cmu.edu/entertainment-analytics/documents/technology-impact-on-entertainment/the-perfect-storm.pdf
- Price, Perry, Mantell, Trinder and Pitts (2019), https://eprints.whiterose.ac.uk/147759/1/08_07_2019_Spontaneit.pdf
- Blom, Pendavingh and Spieksma (2020), https://arxiv.org/pdf/2010.01981
- Fader, Hardie and Lee (2005), http://www.brucehardie.com/papers/018/fader_et_al_mksc_05.pdf
- MPAA (2017), https://www.motionpictures.org/wp-content/uploads/2017/03/2016-Theatrical-Market-Statistics-Report-2.pdf
- DCM and REDC (2025), https://www.dcm.co.uk/uploads/documents/Cinema_-_A_Family_Favourite_%28DCM_x_REDC%29.pdf
- DCMS Participation Survey 2024/25 main report, https://www.gov.uk/government/statistics/participation-survey-2024-25-annual-publication/main-report-for-the-participation-survey-april-2024-to-march-2025
- AMC Q4 2024 results exhibit, https://investor.amctheatres.com/sec-filings/all-sec-filings/content/0001411579-25-000037/amc-20250225xex99d1.htm
- Vista Group (2023), https://vista.co/insights/the-impact-of-concession-discounts-on-moviegoer-spend
- Kaymaz (2021), literature summary of price elasticities, https://dergipark.org.tr/tr/download/article-file/947966
