import Anthropic from '@anthropic-ai/sdk';
import { Tenant } from '@prisma/client';
import { z } from 'zod';
import { Errors } from '../common/errors';
import type { PulseService, SimulateBody } from './pulse.service';

/*
 * Ask Pulse: the conversational side of the AI layer. Claude answers an operator's question by
 * calling Pulse's own endpoints as tools; every figure in an answer comes from a tool result.
 * Pulse works without this (deterministic, free); this works only with Pulse behind it.
 *
 * Off unless ANTHROPIC_API_KEY is set: each question is a paid API call. See
 * docs/decisions/0007-ask-pulse.md.
 */

export const ASK_MODEL = 'claude-opus-5-5';
const MAX_TURNS = 6;

const SYSTEM = `You are Ask Pulse, the operations assistant inside Seatfold, a cinema booking platform. You help cinema operators decide what to programme, how to price, how to staff and what to prepare.

How you work:
- Every number you give must come from a tool result in this conversation. Never estimate, round up or invent figures, prices or percentages. If the tools cannot answer, say so plainly and suggest where in the portal to look.
- Pulse's forecasts, simulations and suggestions are the source of truth. You explain them; you do not override them.
- If a tool result's basis mentions demo history or demo figures, say once that the numbers come from demo data.
- Simulations change nothing. When you suggest acting, name the page in the portal where the operator does it (Seats & ticket prices, Screens & seat maps, Today, Next 6 weeks, Loyalty & memberships, Offers).
- To test an idea such as adding, cancelling or moving a show, or changing a price, call pulse_simulate with real ids from pulse_forecasts. Use pulse_venues to turn a cinema name into an id.
- Mention the assumptions a simulation lists when they matter to the decision.

Style: British English, plain language, short paragraphs or a few bullets, answer first. No em dashes. Money in pounds.`;

const id = z.string().min(1).max(64);
const inputs = {
  pulse_brief: z.object({}).strict(),
  pulse_venues: z.object({}).strict(),
  pulse_forecasts: z.object({ venueId: id.optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.number().int().min(1).max(14).optional() }).strict(),
  pulse_simulate: z
    .object({
      venueId: id,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      change: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('add'), filmId: id, auditoriumId: id, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
        z.object({ kind: z.literal('remove'), screeningId: id }),
        z.object({ kind: z.literal('move'), screeningId: id, auditoriumId: id }),
        z.object({ kind: z.literal('price'), screeningId: id, percent: z.number().min(-50).max(50) }),
      ]),
    })
    .strict(),
  pulse_accuracy: z.object({}).strict(),
  pulse_learned: z.object({}).strict(),
};
type ToolName = keyof typeof inputs;

/** Tool definitions, in a fixed order so the cached prefix never changes. */
export const ASK_TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: 'pulse_brief', description: "The week's best moves from Pulse: each with simulated impact (tickets and food), confidence and the portal page where the operator acts. Start here for 'what should I do' questions.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pulse_venues', description: "The operator's cinemas with their ids and names.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'pulse_forecasts',
    description: 'Forecasts for upcoming screenings: expected admissions with an 80% range, seats sold so far, pace against a usual show, confidence and the drivers behind each number. Also returns screening, film and screen ids needed by pulse_simulate.',
    input_schema: {
      type: 'object',
      properties: { venueId: { type: 'string', description: 'Limit to one cinema (from pulse_venues).' }, date: { type: 'string', description: 'First day, YYYY-MM-DD. Default today.' }, days: { type: 'integer', description: 'How many days, 1 to 14. Default 2.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'pulse_simulate',
    description: "What-if for one cinema-day using Pulse's night choice model: add a show, cancel one, move one to another screen, or change one show's price. Returns the change in admissions and ticket revenue, audience taken from other shows, and the assumptions. Changes nothing.",
    input_schema: {
      type: 'object',
      properties: {
        venueId: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD in the cinema time zone' },
        change: {
          type: 'object',
          description: "One of: {kind:'add', filmId, auditoriumId, time:'HH:MM'}, {kind:'remove', screeningId}, {kind:'move', screeningId, auditoriumId}, {kind:'price', screeningId, percent (-50 to 50, not 0)}",
          properties: { kind: { type: 'string', enum: ['add', 'remove', 'move', 'price'] }, filmId: { type: 'string' }, auditoriumId: { type: 'string' }, time: { type: 'string' }, screeningId: { type: 'string' }, percent: { type: 'number' } },
          required: ['kind'],
        },
      },
      required: ['venueId', 'date', 'change'],
      additionalProperties: false,
    },
  },
  { name: 'pulse_accuracy', description: "How accurate Pulse has been on recent weeks it had not seen: typical error a week, a day and three hours out, how often its 80% range held, and the UK-averages baseline.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pulse_learned', description: 'What Pulse has learned about this operator: how each cinema, day, time of day, week of release and film runs against the norm, and audience interest per film.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
];

export interface AskTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AskResult {
  answer: string;
  toolCalls: { name: string; input: unknown }[];
  model: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export const askConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export class PulseAssistant {
  constructor(
    private readonly pulse: PulseService,
    private client: Pick<Anthropic, 'beta'> | null = null,
  ) {}

  private api(): Pick<Anthropic, 'beta'> {
    if (this.client) return this.client;
    if (!askConfigured()) throw Errors.unavailable('Ask Pulse is not switched on for this platform. Pulse itself works as normal.');
    this.client = new Anthropic();
    return this.client;
  }

  /** Runs one tool call against Pulse. Inputs are validated before anything runs. */
  async runTool(t: Tenant, name: string, raw: unknown): Promise<unknown> {
    if (!(name in inputs)) return { error: `Unknown tool ${name}` };
    const parsed = inputs[name as ToolName].safeParse(raw ?? {});
    if (!parsed.success) return { error: 'Invalid input', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    const input = parsed.data as Record<string, unknown>;
    switch (name as ToolName) {
      case 'pulse_brief':
        return this.pulse.brief(t);
      case 'pulse_venues':
        return this.pulse.venuesForAsk(t);
      case 'pulse_forecasts': {
        const from = (input.date as string | undefined) ? new Date(`${input.date}T00:00:00Z`) : new Date();
        const to = new Date(from.getTime() + ((input.days as number | undefined) ?? 2) * 86400_000);
        const f = await this.pulse.forecasts(t, { venueId: input.venueId as string | undefined, from: from.toISOString(), to: to.toISOString() });
        // Trim to what the model needs, so answers stay quick and cheap.
        return {
          basis: f.basis,
          forecasts: f.forecasts.slice(0, 80).map((x) => ({
            screeningId: x.screeningId,
            date: x.localDate,
            time: x.localTime,
            venue: x.venue,
            screen: x.screen,
            film: x.film,
            expected: x.expected,
            range: [x.low, x.high],
            capacity: x.capacity,
            soldNow: x.soldNow,
            paceIndex: x.paceIndex,
            confidence: x.confidence,
            drivers: x.drivers.slice(0, 4).map((d) => d.label),
          })),
        };
      }
      case 'pulse_simulate':
        return this.pulse.simulate(t, input as unknown as SimulateBody);
      case 'pulse_accuracy': {
        const a = await this.pulse.accuracy(t);
        return { basis: a.basis, folds: a.folds, pulse: a.pulse, baselines: a.baselines };
      }
      case 'pulse_learned': {
        const m = await this.pulse.model(t);
        return { basis: m.basis, priors: m.priors, multipliers: m.multipliers, interest: m.interest };
      }
    }
  }

  async ask(t: Tenant, question: string, history: AskTurn[] = []): Promise<AskResult> {
    const client = this.api();
    const messages: Anthropic.Beta.BetaMessageParam[] = [...history.slice(-8).map((h) => ({ role: h.role, content: h.text })), { role: 'user', content: question }];
    const toolCalls: AskResult['toolCalls'] = [];
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    let model = ASK_MODEL;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model: ASK_MODEL,
          max_tokens: 16000,
          output_config: { effort: 'medium' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          // Tools and instructions are fixed, so they cache across questions.
          cache_control: { type: 'ephemeral' },
          system: SYSTEM,
          tools: ASK_TOOLS,
          messages,
        });
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) throw Errors.unavailable('Ask Pulse is busy. Try again in a minute.');
        if (e instanceof Anthropic.AuthenticationError) throw Errors.unavailable('Ask Pulse is not set up correctly on this platform.');
        if (e instanceof Anthropic.APIError) throw Errors.unavailable('Ask Pulse could not answer just now. Pulse itself works as normal.');
        throw e;
      }
      model = response.model;
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;
      usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
      const text = () =>
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
      if (response.stop_reason === 'refusal') return { answer: "I can't help with that one. Ask me about forecasts, prices, screens, staffing or members.", toolCalls, model, usage };
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      if (response.stop_reason !== 'tool_use') return { answer: text() || 'I could not find an answer in Pulse for that.', toolCalls, model, usage };
      messages.push({ role: 'assistant', content: response.content });
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      // All results go back in one user message, so Claude can keep calling tools in parallel.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
        uses.map(async (u) => {
          toolCalls.push({ name: u.name, input: u.input });
          try {
            return { type: 'tool_result' as const, tool_use_id: u.id, content: JSON.stringify(await this.runTool(t, u.name, u.input)) };
          } catch (e) {
            return { type: 'tool_result' as const, tool_use_id: u.id, is_error: true, content: e instanceof Error ? e.message : 'Tool failed' };
          }
        }),
      );
      messages.push({ role: 'user', content: results });
    }
    return { answer: 'That needed more steps than I allow for one question. Try asking about one cinema or one day.', toolCalls, model, usage };
  }
}
