/**
 * 2-level cache: in-memory Map (LRU, capped at MAX_ENTRIES) + localStorage.
 * All localStorage keys are prefixed with "snp:" to avoid collisions.
 */

const LS_PREFIX = 'snp:';
const MAX_ENTRIES = 100;

export class Cache {
  constructor() {
    /** @type {Map<string, { value: unknown, expiresAt: number }>} */
    this._mem = new Map();
  }

  /**
   * Retrieve a value. Returns null on miss or expiry.
   * A localStorage hit is promoted back into memory.
   */
  get(key) {
    const now = Date.now();

    // 1. Check memory
    if (this._mem.has(key)) {
      const entry = this._mem.get(key);
      if (entry.expiresAt > now) {
        // LRU: re-insert to make it most-recent
        this._mem.delete(key);
        this._mem.set(key, entry);
        return entry.value;
      }
      this._mem.delete(key);
    }

    // 2. Check localStorage
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (raw) {
        const entry = JSON.parse(raw);
        if (entry.expiresAt > now) {
          // Promote to memory
          this._evictIfNeeded();
          this._mem.set(key, entry);
          return entry.value;
        }
        localStorage.removeItem(LS_PREFIX + key);
      }
    } catch {
      // localStorage unavailable or parse error — treat as miss
    }

    return null;
  }

  /**
   * Store key → value with the given TTL (milliseconds).
   * Writes both memory and localStorage.
   */
  set(key, value, ttlMs) {
    const entry = { value, expiresAt: Date.now() + ttlMs };

    // Memory layer
    this._evictIfNeeded();
    this._mem.delete(key); // remove so re-insert lands at end (most-recent)
    this._mem.set(key, entry);

    // Persistence layer
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Quota exceeded or unavailable — skip persistence, keep memory
    }
  }

  /** Remove a key from both layers. */
  del(key) {
    this._mem.delete(key);
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      // ignore
    }
  }

  /** Wipe all keys that start with snp: from localStorage, and clear memory map. */
  clear() {
    this._mem.clear();
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
  }

  /** LRU eviction: remove the oldest (first) entry when at capacity. */
  _evictIfNeeded() {
    if (this._mem.size >= MAX_ENTRIES) {
      const oldest = this._mem.keys().next().value;
      this._mem.delete(oldest);
    }
  }
}

/** Singleton used by all utility modules. */
export const appCache = new Cache();
