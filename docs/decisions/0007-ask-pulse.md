# 0007: Ask Pulse, and how Pulse and the AI layer fit together

Status: accepted, November 2026

## Context

The portal has an AI layer (the ✦ AI insights toggle, AI panel and AI forecast styling) that has run on labelled sample data. Seatfold Pulse (0006) is a deterministic forecasting and decision engine. Operators should be able to use either on its own, and get more when both are on.

## Decision

Three layers, each usable alone:

1. **Pulse** (no AI). Forecasts, simulator, brief, accuracy. Deterministic, free to run, auditable. Every Pulse page works without the AI layer.
2. **AI layer, briefed by Pulse** (no language model). `GET pulse/brief` turns Pulse into the AI panel's shape: moves with simulated impact, confidence and where to act. The panel uses it when Pulse has a brief, and falls back to labelled sample insights otherwise. No per-call cost.
3. **Ask Pulse** (language model). `POST pulse/ask` lets an operator ask a question; Claude answers by calling Pulse's own endpoints as tools (`brief`, `venues`, `forecasts`, `simulate`, `accuracy`, `learned`). The system prompt requires every figure to come from a tool result. Off unless `ANTHROPIC_API_KEY` is set, because each question is a paid API call.

### Dependency

`@anthropic-ai/sdk` (backend only). Reason: the official SDK gives typed requests, typed errors (rate limit, authentication) and retries; hand-rolled HTTP would duplicate that and drift from the API. No other new dependency.

### Model and settings

- `claude-opus-5-5`, effort `medium` (its default, set explicitly), adaptive thinking (the model's default).
- Prompt caching: the system prompt and tool list are fixed and cached across questions (`cache_control` on the request).
- Server-side refusal fallback on (`server-side-fallback-2026-07-01`, `fallbacks: "default"`).
- Manual tool loop, at most six model turns per question; tool inputs are validated with zod before any Pulse call; a bad input returns an error result rather than failing the request.
- No write tools: Ask Pulse can simulate but cannot change prices, screenings or offers.

### Cost

Per question, roughly a few thousand input tokens (mostly cached after the first question) and a few hundred output tokens, plus tool results. The platform owner decides whether to switch it on; Seatfold does not call the API without a key.

## Alternatives considered

- **A language model producing forecasts.** Rejected in 0006: not reproducible, costs per call, cannot be audited.
- **Raw `fetch` to the Messages API.** Rejected: loses typed errors and retries, and the SDK is the supported path.
- **Write tools (apply a price, add a screening).** Deferred: needs an approval step in the portal and audit logging first.
