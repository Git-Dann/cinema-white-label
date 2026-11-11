# Seatfold Pulse

Pulse is Seatfold's own demand model. It forecasts how many people will come to every screening, explains why in plain English, and turns that forecast into decisions: prices, screens, staffing, food prep, bundles, customer segments, recommendations and alerts.

It is deterministic and explainable. There is no machine-learning library and no AI call. Every number can be traced back to a formula below and to the data it learned from. AI can sit on top later (to write summaries or answer questions), but the numbers never depend on it.

Code: `backend/src/intelligence`. API: `/v1/admin/t/{tenant}/pulse/*` and `/v1/t/{tenant}/me/recommendations`.

## How a forecast is made

For each screening:

1. **Prior.** What a show like this usually does, before we know anything about this operator:

   `prior = capacity × slot base × release decay × film strength × format × school holiday`

   - **Slot base** is the expected share of seats filled for the time slot: weekday daytime, weekday evening (including Sunday evening), Friday or Saturday evening, weekend daytime, late show (21:30 or later). Bank holidays count as Saturdays and the day before one as a Friday.
   - **Release decay** is `weekly retention ^ (week of release − 1)`, with retention set by genre (below).
   - **Film strength** is `0.8 + 0.4 × popularity rank`, kept between 0.6 and 1.8. The rank is the film's TMDB popularity percentile among the operator's films. Films without TMDB data are neutral (×1).
   - **Format**: IMAX and 4DX ×1.15, 3D ×1.05.
   - **School holiday**: daytime shows ×1.3.

2. **Learned multipliers.** What this operator's own results say, layered on the prior:

   `μ = prior × m(cinema) × m(slot) × m(weekday) × m(release week band) × m(film)`

   Each multiplier is fitted by iterative proportional fitting (four passes) over past outcomes, with empirical-Bayes shrinkage:

   `m = (admissions seen + k) ÷ (admissions expected + k)`, with `k = 150`

   A cinema with only a handful of shows stays close to ×1, and one with hundreds moves to what its data says. Multipliers are kept between 0.4 and 2.5.

3. **Booking curve (pace).** For each slot we know what share of final sales is usually sold by 168, 72, 48, 24, 12, 6, 3 and 1 hours before the start. The curve is the median of past shows' curves, blended with a prior logistic curve until there are about 20 shows to learn from. `F(h)` is the share usually sold `h` hours out.

   `pace projection = sold now ÷ F(h)`

4. **Blend.** Early on we trust the model; close to the start we trust the actual sales:

   `w = F(h)^0.7`, `expected = w × pace projection + (1 − w) × μ`

   The result is never below seats already sold or above capacity.

5. **Range.** An 80% band from a negative binomial spread (`sd = √(E + E²/8)`), narrowed as more of the show has sold through (`× (1 − 0.8w)`), and clamped to what's possible.

6. **Pace index** is `sold now ÷ (μ × F(h))`: 1 means on track, 1.3 means 30% ahead.

7. **Confidence** is high once the cinema has 200 or more past shows and half the sales are usually in, or once 80% are usually in. It is medium with 50 or more shows or 40% sold through, and low otherwise.

Every forecast comes with **drivers**: the factors that moved it, with their size and a sentence, for example "Week 3 of release: ×0.49. As a typical film, it usually keeps about 60% of its audience each week."

## What Pulse does with a forecast

| Module | Rule |
|---|---|
| Pricing | Within 72 hours: raise by 10% (15% when forecast 95% full or 50% ahead of pace) if forecast at least 85% full, or at least 60% full and 30% ahead of pace. Under 24 hours: suggest off-peak (20%, or 25% when at most 15% full) if forecast at most 30% full. Capped at +20% and −30%. The operator approves every change. |
| Screens | At one cinema, when a show is forecast at least 90% full and a bigger screen starting within 45 minutes is forecast at most 50% full, suggest swapping them if it sells at least 5 more seats. |
| Staffing | Arrivals per 30 minutes: 60% of a show's audience in the 30 minutes before the start, 30% in the 30 before that, 10% earlier. Tills needed = arrivals × 0.75 minutes service ÷ 30 ÷ 0.8 utilisation, rounded up. One usher per 120 admissions starting. Compared with the rota (shifts from Connections) to find gaps. |
| Food prep | Expected food orders = forecast × attach rate, learned by certificate band (family, teen, adult) and time of day, shrunk towards 0.35. Quantities by product from the last 60 days' order mix. |
| Bundles | Association rules over food orders: support (share of orders with both), confidence and lift. Pairs in at least 2% of orders with lift above 1.1. |
| Loyalty | Recency, frequency and spend scored 1 to 5 within the operator's customers. Segments: Champions, Regulars, Family matinee, New, Occasional, Lapsing, Lost. Churn risk = days since last visit ÷ the customer's own median gap; 2 or more is at risk. Only counts leave the API, never names or emails. |
| Recommendations | Co-booking (Jaccard similarity of the customers who booked each film) plus 0.3 × genre and certificate likeness, so new films can be recommended before anyone has co-booked them. With no history: the films selling best now. |
| Alerts | For the last 14 days, each cinema-day's actual admissions against the model's expectation. Robust z-score of `log(actual ÷ forecast)` using the median and median absolute deviation; flagged at 2.5 or more either way. |

## Where the data comes from

- **Show outcomes** (`ShowOutcome`): one row per finished screening, rolled up nightly by the daily cron from seat inventory (admissions, capacity), confirmed bookings (revenue, food, booking times for the curve) and the calendar.
- **Demo history**: the demo operators (Northlight, Kestrel) get 26 weeks of simulated outcomes so Pulse has something to learn from. It is generated from a hidden pattern with noise, stored with `source: "demo"`, and every API response says so in `basis` (for example "Based on 26 weeks of demo history"). Demo food orders and demo customers stand in for baskets and loyalty while the demo operators' real data is thin, and are labelled the same way.
- **Bank holidays**: the gov.uk feed, refreshed by the daily cron and cached in the database, with a committed snapshot in `shared/fixtures/calendar` for tests and offline use. The venue's nation comes from its postcode (Scotland, Northern Ireland, or England and Wales).
- **School holidays**: an approximate England and Wales table for 2025 to 2028 in `shared/fixtures/calendar`. There is no national source because dates vary by council, so this is a planning approximation that operators will be able to override.

## Where the priors come from

- **Occupancy.** UK multiplex occupancy runs at roughly 15 to 20%. The Independent Cinema Office plans a single screen on 20% as the base case and 15% as the downside, with screens that do very well reaching 30 to 40%. We keep the shape of demand across slots and scale it so a typical week (four shows a day) averages 19%. Source: [Independent Cinema Office, sample sensitivity analysis for one screen](https://www.independentcinemaoffice.org.uk/advice-support/how-to-start-a-cinema/appendix-2-sample-sensitivity-analysis-for-one-screen/).
- **Release decay.** A normal second weekend drops about 40% (we keep 60% a week). Drops above 60% count as weak, and front-loaded films (superhero and action blockbusters, horror) drop 55 to 60% (we keep 42%). Family, animation and drama hold up better at about 30% (we keep 70%). Big openings (top decile of TMDB popularity) use the steeper rate, and May to July releases drop a further 10% a week. Source: [Second weekend in box office performance](https://en.wikipedia.org/wiki/Second_weekend_in_box_office_performance).
- **Film strength.** TMDB popularity, which we already import with each film (Seatfold uses the TMDB API but is not endorsed or certified by TMDB).
- **Bank holidays.** [gov.uk bank holidays](https://www.gov.uk/bank-holidays.json), Open Government Licence v3.0.
- **Arrivals.** Most cinemagoers arrive in the 20 to 30 minutes before the start, hence 60% / 30% / 10%.
- **Weather** is not used. Free forecast APIs such as Open-Meteo restrict commercial use.

## What it cannot do yet

- Forecasts are only as good as the history. A new operator starts on priors and improves week by week. Importing 6 to 12 months of past sales makes it useful from day one.
- Prices, screens and rotas are suggestions. Nothing changes without the operator.
- The school holiday table is approximate and not yet editable per operator.
