'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ACTIONS = new Set(['walk', 'crawl', 'climb', 'jump', 'rest', 'think', 'seek_attention']);
const AUTONOMY_SCENES = Object.freeze({
  walk: ['curious_sniff', 'window_gaze'],
  crawl: ['belly_crawl'],
  climb: ['brave_climb'],
  jump: ['playful_spin'],
  rest: ['sleepy_nod'],
  think: ['focus_quiet', 'window_gaze', 'morning_stretch', 'clumsy_bonk'],
  seek_attention: ['peek_hello', 'proud_little'],
});

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

/**
 * Small deterministic-ish needs engine. It is deliberately local: no cloud
 * inference and no access to chat, screen, or window content.
 */
class PetBrain {
  constructor({ file = '', now = Date.now, random = Math.random } = {}) {
    this.file = file;
    this.now = now;
    this.random = random;
    this.state = this._load();
  }

  _load() {
    const base = {
      energy: 68,
      curiosity: 72,
      social: 42,
      lastDecisionAt: 0,
      lastTickAt: Date.now(),
      lastAction: '',
      lastScene: '',
      actionCounts: {},
    };
    if (!this.file) return base;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        ...base,
        ...saved,
        energy: clamp(saved.energy ?? base.energy),
        curiosity: clamp(saved.curiosity ?? base.curiosity),
        social: clamp(saved.social ?? base.social),
        actionCounts: saved.actionCounts && typeof saved.actionCounts === 'object' ? saved.actionCounts : {},
      };
    } catch {
      return base;
    }
  }

  _save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state), 'utf8');
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch {
      /* brain state is best-effort */
    }
  }

  _updateNeeds(context) {
    const now = Number(this.now());
    const elapsedMin = Math.max(0, Math.min(60, (now - Number(this.state.lastTickAt || now)) / 60000));
    this.state.lastTickAt = now;
    if (!elapsedMin) return;
    const away = ['away', 'sleeping'].includes(context.presenceKind);
    if (away) {
      this.state.energy = clamp(this.state.energy + elapsedMin * 1.4);
      this.state.curiosity = clamp(this.state.curiosity - elapsedMin * 0.25);
    } else {
      this.state.energy = clamp(this.state.energy - elapsedMin * 0.28);
      this.state.curiosity = clamp(this.state.curiosity + elapsedMin * 0.42);
    }
    this.state.social = clamp(this.state.social + (context.paired ? elapsedMin * 0.34 : elapsedMin * 0.12));
  }

  _pickScene(action, context, now) {
    let candidates = (AUTONOMY_SCENES[action] || []).slice();
    if (action === 'think') {
      const hour = new Date(now).getHours();
      if (['coding', 'focus', 'meeting'].includes(context.presenceKind)) {
        candidates = ['focus_quiet', 'window_gaze'];
      } else if (hour >= 6 && hour < 10) {
        candidates = ['morning_stretch', 'curious_sniff'];
      }
    }
    const fresh = candidates.filter((id) => id !== this.state.lastScene);
    const pool = fresh.length ? fresh : candidates;
    return pool[Math.floor(this.random() * pool.length)] || 'window_gaze';
  }

  observe(context = {}) {
    this._updateNeeds(context);
    const now = Number(this.now());
    this._save();
    if (!context.visible || context.busy || context.pointerNear || context.enabled === false) return null;
    if (context.lastInteractionAt && now - context.lastInteractionAt < 12000) return null;
    if (now - Number(this.state.lastDecisionAt || 0) < 18000) return null;

    let action = '';
    let reason = '';
    if (this.state.energy < 30) {
      action = 'rest';
      reason = 'low_energy';
    } else if (this.state.social > 76 && context.paired) {
      action = 'seek_attention';
      reason = 'missing_partner';
    } else if (this.state.curiosity > 64) {
      const exploreRoll = this.random();
      action = exploreRoll < 0.45
        ? 'crawl'
        : exploreRoll < 0.75
          ? 'walk'
          : exploreRoll < 0.93
            ? 'jump'
            : 'climb';
      reason = 'curiosity';
    } else if (this.state.social > 58 && this.random() < 0.45) {
      action = 'seek_attention';
      reason = 'social';
    } else if (this.random() < 0.28) {
      action = 'think';
      reason = 'idle_thought';
    }
    if (!ACTIONS.has(action)) return null;

    const costs = {
      walk: { energy: -2, curiosity: -8, social: -2 },
      crawl: { energy: -1, curiosity: -6, social: -1 },
      climb: { energy: -5, curiosity: -12, social: -2 },
      jump: { energy: -4, curiosity: -7, social: -1 },
      rest: { energy: 12, curiosity: 1, social: 0 },
      think: { energy: -1, curiosity: -2, social: -3 },
      seek_attention: { energy: -1, curiosity: 0, social: -15 },
    }[action];
    this.state.energy = clamp(this.state.energy + costs.energy);
    this.state.curiosity = clamp(this.state.curiosity + costs.curiosity);
    this.state.social = clamp(this.state.social + costs.social);
    this.state.lastDecisionAt = now;
    this.state.lastAction = action;
    this.state.lastScene = this._pickScene(action, context, now);
    this.state.actionCounts[action] = (this.state.actionCounts[action] || 0) + 1;
    this._save();
    return {
      action,
      scene: this.state.lastScene,
      reason,
      energy: Math.round(this.state.energy),
      curiosity: Math.round(this.state.curiosity),
      social: Math.round(this.state.social),
    };
  }

  snapshot() {
    return { ...this.state, actionCounts: { ...this.state.actionCounts } };
  }
}

module.exports = { PetBrain, ACTIONS, AUTONOMY_SCENES };
