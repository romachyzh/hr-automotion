export class SageHRError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly endpoint: string;

  constructor(message: string, opts: { status: number; body: unknown; endpoint: string }) {
    super(message);
    this.name = "SageHRError";
    this.status = opts.status;
    this.body = opts.body;
    this.endpoint = opts.endpoint;
  }
}

export class SageHRAuthError extends SageHRError {
  constructor(opts: { body: unknown; endpoint: string }) {
    super("SageHR API rejected the credentials (401). Check SAGEHR_API_KEY.", {
      status: 401,
      body: opts.body,
      endpoint: opts.endpoint,
    });
    this.name = "SageHRAuthError";
  }
}

export class SageHRNotFoundError extends SageHRError {
  constructor(opts: { body: unknown; endpoint: string }) {
    super(`SageHR resource not found at ${opts.endpoint}`, {
      status: 404,
      body: opts.body,
      endpoint: opts.endpoint,
    });
    this.name = "SageHRNotFoundError";
  }
}

export class SageHRRateLimitError extends SageHRError {
  readonly retryAfterSeconds: number | null;
  constructor(opts: { body: unknown; endpoint: string; retryAfterSeconds: number | null }) {
    super("SageHR API rate-limited the request (429).", {
      status: 429,
      body: opts.body,
      endpoint: opts.endpoint,
    });
    this.name = "SageHRRateLimitError";
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}
