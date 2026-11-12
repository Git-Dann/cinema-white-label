# 0006: Pulse is deterministic and explainable

Date: 2026-11-12

## Decision

Seatfold's demand forecasting and the features built on it (pricing, screens, staffing, food prep, bundles, loyalty segments, recommendations, alerts) use our own deterministic model, Pulse (`docs/pulse.md`), written in TypeScript with no new dependencies.

## Why

- **Operators must trust the numbers.** Every forecast carries the factors that moved it and the data it learned from. An operator can see "Friday evening ×1.62, week 3 of release ×0.49" and check it against what they know.
- **It works from day one.** Priors calibrated to published UK figures give sensible forecasts before an operator has any history. Empirical-Bayes shrinkage stops thin data from producing wild numbers, and the model moves towards the operator's own pattern as sales arrive.
- **It's cheap and private.** It runs inside the API on every request, costs nothing per call and sends no customer data anywhere.
- **It's testable.** Pure functions with unit tests. The same inputs always give the same answer.
- **AI stays optional.** A language model can explain or summarise Pulse's output later, but nothing depends on it.

## Not chosen

- **Gradient boosting or neural forecasters.** More accurate with lots of data, but opaque, need a training pipeline, and add dependencies. They are worth revisiting once operators have years of history, and could slot in behind the same API.
- **Calling an LLM for forecasts.** Not reproducible, costs per call, and can't be audited.
- **Weather.** Free forecast APIs restrict commercial use.
