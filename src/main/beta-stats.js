'use strict';

/**
 * Cubbit beta event log (schema v2).
 *
 * The log is local-first and never uploads automatically. Common fields:
 *   schema: 2
 *   eid:    unique event id for cross-file deduplication
 *   s:      app-session id
 *   t/day:  local timestamp and local calendar day
 *   event:  one of EVENT_FIELDS
 *   v:      app version
 *   i:      12-char install id
 *   c:      cohort: couple | solo | unknown
 *   g:      pseudonymous pairing-group hash; identical on both paired devices
 *   ch:     release channel
 *   x:      experiment id
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;
const COHORTS = new Set(['couple', 'solo', 'unknown']);

/** Event-specific fields are allow-listed so future features cannot leak content. */
const EVENT_FIELDS = Object.freeze({
  app_open: ['cold'],
  cohort_assigned: ['cohort', 'source'],
  onboarding_done: ['pairChoice'],
  pair_intent: ['role', 'method'],
  pair_success: ['role', 'method'],
  pair_failed: ['role', 'code'],
  msg_in: ['type', 'catchup'],
  interaction_in: ['action', 'catchup'],
  interaction_local: ['type'],
  animal_selected: ['animal'],
    autonomy_action: ['action', 'scene', 'reason', 'energy', 'curiosity', 'social'],
  couple_focus: ['event'],
  partner_presence: ['online'],
});

function localDay(timestamp) {
  const dt = new Date(timestamp);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

function safePrimitive(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 80);
  return undefined;
}

function normalizeCohort(value) {
  const cohort = String(value || '').trim().toLowerCase();
  return COHORTS.has(cohort) ? cohort : 'unknown';
}

function hashPairingGroup(groupId) {
  const value = String(groupId || '').trim();
  if (!value) return '';
  return crypto
    .createHash('sha256')
    .update(`cubbit-beta-pair-v2:${value}`)
    .digest('hex')
    .slice(0, 16);
}

class BetaStats {
  constructor(opts = {}) {
    this.dir = opts.dir || '';
    this.version = String(opts.version || '');
    this.installId = String(opts.installId || '').slice(0, 12);
    this.now = opts.now || Date.now;
    this.cohortProvider = opts.cohortProvider || (() => 'unknown');
    this.groupProvider = opts.groupProvider || (() => '');
    this.channel = String(opts.channel || 'beta');
    this.experiment = String(opts.experiment || 'softlaunch-2026-11');
    this.sessionId = opts.sessionId || crypto.randomUUID();
    this.file = this.dir ? path.join(this.dir, 'beta-events.jsonl') : '';
  }

  filePath() {
    return this.file;
  }

  cohort() {
    try {
      return normalizeCohort(this.cohortProvider());
    } catch {
      return 'unknown';
    }
  }

  groupHash() {
    try {
      return hashPairingGroup(this.groupProvider());
    } catch {
      return '';
    }
  }

  /** Validate + log a schema-v2 event. Unknown events/fields are ignored. */
  log(event, data = {}) {
    if (!this.file || !event || !Object.prototype.hasOwnProperty.call(EVENT_FIELDS, event)) {
      return null;
    }
    const at = Number(this.now());
    if (!Number.isFinite(at) || at < 0) return null;

    const payload = {};
    for (const key of EVENT_FIELDS[event]) {
      const value = safePrimitive(data[key]);
      if (value !== undefined) payload[key] = value;
    }

    const entry = {
      schema: 2,
      eid: crypto.randomUUID(),
      s: this.sessionId,
      t: Math.floor(at),
      day: localDay(at),
      event,
      v: this.version,
      i: this.installId,
      c: this.cohort(),
      g: this.groupHash(),
      ch: this.channel,
      x: this.experiment,
      ...payload,
    };

    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      try {
        if (fs.statSync(this.file).size > MAX_BYTES) fs.renameSync(this.file, `${this.file}.1`);
      } catch {
        /* first write */
      }
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      return null;
    }
    return entry;
  }

  tail(limit = 500) {
    if (!this.file) return [];
    try {
      return fs
        .readFileSync(this.file, 'utf8')
        .trim()
        .split('\n')
        .slice(-Math.max(1, limit))
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

module.exports = {
  BetaStats,
  COHORTS,
  EVENT_FIELDS,
  hashPairingGroup,
  localDay,
  normalizeCohort,
};
