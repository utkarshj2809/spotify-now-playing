/**
 * Token-bucket rate limiter with per-host queuing and automatic 429 back-off.
 *
 * Usage:
 *   const result = await limiter.schedule(() => fetch(url));
 */
export class RateLimiter {
  /**
   * @param {number} requestsPerSecond  Maximum calls per second
   * @param {{ onPause?: (pauseUntilMs: number) => void, onResume?: () => void }} [callbacks]
   */
  constructor(requestsPerSecond, callbacks = {}) {
    this._rps      = requestsPerSecond;
    this._interval = 1000 / requestsPerSecond; // ms between slots
    this._queue    = [];          // Array of { fn, resolve, reject }
    this._running  = false;
    this._paused   = false;
    this._pauseUntil = 0;
    this._onPause  = callbacks.onPause  || null;
    this._onResume = callbacks.onResume || null;
  }

  /**
   * Update pause/resume callbacks after construction.
   */
  setCallbacks({ onPause, onResume } = {}) {
    this._onPause  = onPause  || null;
    this._onResume = onResume || null;
  }

  /**
   * Schedule `fn` to run once a rate-limit slot is available.
   * Returns a Promise that resolves / rejects with fn's result.
   */
  schedule(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      if (!this._running) this._drain();
    });
  }

  /** Internal: drain the queue at the configured rate. */
  async _drain() {
    this._running = true;

    while (this._queue.length > 0) {
      // Honour any active pause (from a 429)
      const now = Date.now();
      if (this._paused && now < this._pauseUntil) {
        await this._sleep(this._pauseUntil - now);
        this._paused = false;
      }

      const item = this._queue.shift();
      if (!item) break;

      try {
        const result = await this._executeWithRetry(item.fn);
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }

      // Wait for the next slot (unless queue is now empty)
      if (this._queue.length > 0) {
        await this._sleep(this._interval);
      }
    }

    this._running = false;
  }

  /**
   * Execute fn; on HTTP 429, read Retry-After, pause, and retry once.
   */
  async _executeWithRetry(fn) {
    const response = await fn();

    // If fn returned a Response and it's a 429, back off and retry
    if (response instanceof Response && response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
      const pauseMs = (isNaN(retryAfter) ? 5 : retryAfter) * 1000;
      this._paused     = true;
      this._pauseUntil = Date.now() + pauseMs;
      if (this._onPause) this._onPause(this._pauseUntil);
      await this._sleep(pauseMs);
      this._paused = false;
      if (this._onResume) this._onResume();
      // Retry once
      return fn();
    }

    return response;
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, Math.max(0, ms)));
  }
}

// Named instances ─────────────────────────────────────────────
export const spotifyLimiter  = new RateLimiter(3); // 3 req/s
export const lrclibLimiter   = new RateLimiter(2); // 2 req/s
export const paxsenixLimiter = new RateLimiter(2); // 2 req/s
