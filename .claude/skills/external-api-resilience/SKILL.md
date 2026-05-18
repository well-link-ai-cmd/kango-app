---
name: external-api-resilience
description: When the user reports a raw external API error (overloaded, timeout, rate-limit, 5xx, network) leaking to end users in the UI, or asks how to handle a flaky upstream service, introduce classified retry + user-facing "what to do next" messages. Triggers include screenshots of raw error JSON, mentions of HTTP codes like 429/500/502/503/504/529, words like "Overloaded" / "rate limit" / "timeout" visible to non-developers, or new code paths that call an external API (Anthropic, OpenAI, Supabase, Stripe, etc.) and could fail mid-flow.
---

# External API Resilience

When an external API call fails, end users should experience:

1. **Fewer visible failures** — transient errors get auto-retried behind the scenes
2. **Actionable messages when retry exhausts** — never raw JSON, status codes, or "An error occurred"; always say what to do next and what's safe (input saved, no data lost)

This skill encodes the pattern, the trade-offs, and the implementation shape.

---

## Step 1 — Classify the failure by user action

The classification is **what the user should DO**, not what HTTP code came back. Group all failures into these kinds:

| Kind | Triggers | What the user should do |
|---|---|---|
| `overloaded` | HTTP 529, 503, 502, 504, body type `overloaded_error` | Wait 1–2 min, retry the button |
| `rate_limit` | HTTP 429, body type `rate_limit_error` | Wait ~1 min, retry |
| `timeout` | request exceeded our timeout, `APIConnectionTimeoutError`, fetch failed | Check connection, retry |
| `auth` | HTTP 401, 403, missing/invalid API key | Contact admin (cannot self-resolve) |
| `bad_request` | HTTP 400, 422 | Check input, fix and retry |
| `other` | HTTP 500 unspecified, anything unclassified | Wait briefly, retry, contact admin if persistent |

If the user can't act on it (e.g. auth), say so explicitly so they don't keep retrying.

---

## Step 2 — Retry transient errors automatically

**Retry only `overloaded` and `rate_limit`.**

- Exponential backoff: 2 s → 4 s. Cap at 2 retries (3 total attempts). Total wait should stay under ~10 s so the human in front of the screen doesn't give up.
- **Do not auto-retry `timeout`** — the user already waited the timeout duration. Auto-retrying doubles their pain. Surface the error and let them decide.
- **Do not retry `auth` or `bad_request`** — these need human intervention; retrying just wastes time.

Important: on Anthropic, OpenAI, and most major APIs, **failed calls are NOT billed for tokens** — 429s and 5xx errors don't charge. So retry caps are about user wait time, not cost.

---

## Step 3 — User-facing messages

Every message must include three things:

1. **What happened** — in domain language. "AI（Claude）側が混み合っているため" — not "HTTP 529 / overloaded_error".
2. **What to do** — concrete next action. "1〜2分ほど待ってから、もう一度ボタンを押してお試しください". Specify the wait time.
3. **What's safe** — reassurance. "入力内容は自動保存されているので、入力し直しは不要です". Without this, users panic that they lost work.

Avoid:

- Raw JSON, HTTP status codes, request IDs visible to end users
- "Please try again later" with no timeframe
- "An error occurred" with no next step
- Stack traces or error class names

Match the user's language (the kango-app uses Japanese; if a project is English, match that).

---

## Step 4 — Centralize: one classifier, one response helper

Don't sprinkle ad-hoc try/catch with different wording across files. One classifier + one response helper means consistency and a single place to add new failure kinds later.

Shape (TypeScript/Next.js — adapt the language as needed):

```typescript
// lib/api-error.ts
export type ApiErrorKind = 'overloaded' | 'rate_limit' | 'timeout' | 'auth' | 'bad_request' | 'other';

export class ApiError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly kind: ApiErrorKind,
    readonly httpStatus: number,
    readonly userMessage: string,
    cause?: unknown,
  ) {
    super(userMessage);
    this.retryable = kind === 'overloaded' || kind === 'rate_limit';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export function classifyApiError(e: unknown): ApiError {
  // Inspect status / error.type / code / name, build the appropriate ApiError
}
```

Wrap the API call site (not every route) with retry:

```typescript
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try { return await call(); }
  catch (e) {
    const c = classifyApiError(e);
    if (!c.retryable || attempt === maxRetries) throw c;
    await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
  }
}
```

Each route's catch becomes a one-liner:

```typescript
} catch (e) { return apiErrorResponse(e); }
```

---

## Step 5 — Sweep the codebase

After implementing in one place, **find every other call site for the same external API** and apply the same helper. Half-applied resilience is worse than none, because users learn that some flows work and others don't, with no obvious reason.

`grep -rn "<sdk-function-name>"` across the project; convert every catch block.

Exception: routes where errors should fail silently (e.g. an enhancement that shouldn't block the main flow — like an optional suggestion AI) should keep their existing silent fallback. Don't break intentional design.

---

## Step 6 — Verify

- Type-check / build clean
- Lint clean (only pre-existing warnings)
- If you can trigger the error locally (e.g. set an invalid API key for auth, send malformed body for bad_request), check the user-facing string appears
- For `overloaded`/`rate_limit`, the SDK is hard to force-trigger — write a brief test or note in the PR that it's verified by reading the code path

---

## When the user reports a new in-the-wild error

Workflow:

1. Read the screenshot/log. Identify the failure kind from the table.
2. Check existing classifier — does the kind already cover this trigger? If yes, just verify retry coverage and message wording.
3. If it's a new sub-trigger (e.g. a new error body shape), extend the classifier branches.
4. If it's an entirely new kind, add to the union, classifier, and write the user message.
5. Apply across all call sites for that API (Step 5).
6. Commit, push, merge.

---

## Reference implementation

`well-link-ai-cmd/kango-app` PR #14 (commit `cea0b43`) implements this pattern for the Anthropic Claude API across 11 AI routes:

- `lib/ai-client.ts` — `AiError`, `classifyAiError`, retry loop in `generateAiResponse`
- `lib/ai-error-response.ts` — `aiErrorResponse(e)` for route catches
- Each AI route: `} catch (e) { return aiErrorResponse(e); }`
- Intentional exception: `app/api/soap/questions/route.ts` keeps its silent fallback (enhancement that shouldn't block SOAP creation)

Copy this structure when applying to a new project; adapt error-kind triggers to the target API.
