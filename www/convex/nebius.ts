/**
 * Nebius Token Factory — the model that scores a debate.
 *
 * Judging is the one job in this product that is a *measurement* rather than a
 * performance: the debaters entertain, and then something has to say who
 * actually won and why. That is what runs here, on Nebius, and it is why the
 * numbers below are stored rather than logged — the challenge asks for recorded
 * quality, time or cost, and a verdict already carries all three.
 *
 * Deliberately separate from `agent.ts`. That module is the masks' voice and
 * routes through the Firebase bridge so a room can spend its server's key; this
 * one is a single server-side call with its own key and its own model. Keeping
 * them apart means the debaters and the judge can never end up as the same
 * model by accident, which is the point of having a judge at all.
 *
 * The API is OpenAI-shaped, so the request below is the standard
 * `/chat/completions` body. Both the base URL and the model id are environment
 * variables rather than constants: Token Factory's catalogue changes, and a
 * model id that 404s should be a one-line fix on the deployment rather than a
 * redeploy.
 */

const DEFAULT_BASE_URL = 'https://api.tokenfactory.nebius.com/v1';

/**
 * Measured on the real judging prompt against the account's catalogue, not
 * picked for its name:
 *
 *   Qwen/Qwen3-30B-A3B-Instruct-2507      5.5s   valid JSON
 *   meta-llama/Llama-3.3-70B-Instruct    10.8s   valid JSON (283s on a cold first call)
 *   deepseek-ai/DeepSeek-V4-Flash-0731    1.9s   empty completion — unusable here
 *
 * Both working models returned the same winner on the same transcript, so the
 * cheap one costs nothing in agreement and saves a demo from a five-minute
 * pause. That cold start is real: the first call to a model that has not been
 * used recently pays for the wake-up, which is worth one throwaway request
 * before anyone is watching.
 */
const DEFAULT_MODEL = 'Qwen/Qwen3-30B-A3B-Instruct-2507';

export function hasNebius(): boolean {
  return Boolean(process.env.NEBIUS_API_KEY);
}

export function nebiusModel(): string {
  return process.env.NEBIUS_MODEL ?? DEFAULT_MODEL;
}

/** What the room records about a judging call, whether or not it worked. */
export interface NebiusMeasurement {
  ok: boolean;
  model: string;
  /** Wall-clock for the call, which is the number a demo can show. */
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Present when `ok` is false: the http status or the failure kind. */
  error?: string;
}

export interface NebiusReply {
  text: string;
  measurement: NebiusMeasurement;
}

/**
 * One chat completion, with the cost of it.
 *
 * Never throws. A judge that explodes takes the end of the debate with it, and
 * a failed measurement is itself a result worth showing — the challenge asks
 * for a test that fails, and this is where that lands: `ok: false` with the
 * status, and the caller falls back to the room's own model.
 */
export async function callNebius(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  /** 0 for scoring: the same debate should not win on a different night. */
  temperature?: number;
}): Promise<NebiusReply> {
  const key = process.env.NEBIUS_API_KEY;
  const model = nebiusModel();
  const started = Date.now();

  if (!key) {
    return {
      text: '',
      measurement: { ok: false, model, latencyMs: 0, error: 'NEBIUS_API_KEY is not set' },
    };
  }

  const base = process.env.NEBIUS_BASE_URL ?? DEFAULT_BASE_URL;

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1500,
        temperature: opts.temperature ?? 0,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
      }),
    });

    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return {
        text: '',
        measurement: {
          ok: false,
          model,
          latencyMs,
          error: `${res.status}: ${(await res.text()).slice(0, 200)}`,
        },
      };
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content ?? '';

    return {
      text,
      measurement: {
        // An empty completion is a failure even with a 200: there is nothing to score with.
        ok: Boolean(text.trim()),
        model,
        latencyMs,
        promptTokens: body.usage?.prompt_tokens,
        completionTokens: body.usage?.completion_tokens,
        error: text.trim() ? undefined : 'empty completion',
      },
    };
  } catch (err) {
    return {
      text: '',
      measurement: {
        ok: false,
        model,
        latencyMs: Date.now() - started,
        error: `unreachable: ${(err as Error).message}`.slice(0, 200),
      },
    };
  }
}
