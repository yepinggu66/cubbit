'use strict';
/**
 * MateService —— 宠物相亲服务（主进程）。
 *
 * 状态判定放主进程的理由和人生账本一样：好感度、候选池、关系都得一个人说了算，
 * 渲染层可以刷新、可以改系统时间，但改不了"对方是怎么回的"。
 *
 * 候选池两级：
 *   1) remote —— 配了 mateEndpoint 就走网络（真实用户宠物）。
 *      契约：POST {endpoint}/match  { desire, exclude } -> { candidates:[{id,name,species,traits,bio,steps}] }
 *      失败静默回落，绝不因为对方服务器挂了就把功能锁死。
 *   2) local  —— 用 deviceId + 当天日期做种子，离线也能相一次亲。
 *
 * 持久化 <userData>/mate.json。
 */

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { JsonFile } = require('./json-file');
const M = require('../shared/mate');

const FILE_DEFAULTS = { version: 1, state: null };

class MateService extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dir = opts.dir || require('electron').app.getPath('userData');
    this.store = new JsonFile(path.join(this.dir, 'mate.json'), FILE_DEFAULTS);
    this.store.load();
    this.now = opts.now || (() => Date.now());
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this._endpoint = opts.endpoint;
    this._seed = opts.seed;
  }

  /** 配置支持传函数：settings 可能在中途被改，不能构造时读取一份快照。 */
  endpoint() {
    const v = typeof this._endpoint === 'function' ? this._endpoint() : this._endpoint;
    return String(v || '').trim();
  }

  seed() {
    const v = typeof this._seed === 'function' ? this._seed() : this._seed;
    return String(v || 'cubbit');
  }

  _state() {
    const raw = this.store.get('state');
    return M.normalize(raw);
  }

  _commit(state) {
    const next = Object.assign({}, state, { updatedAt: this.now() });
    this.store.patch({ state: next });
    const snap = this.snapshot();
    this.emit('changed', snap);
    return snap;
  }

  snapshot() {
    const state = M.snapshot(this._state(), this.now());
    return {
      ok: true,
      status: state.status,
      desire: state.desire,
      candidates: state.candidates.map((c) =>
        Object.assign({}, c, { fit: M.score(c, state.desire) }),
      ),
      picked: state.picked,
      reply: state.reply,
      relation: state.relation,
      attempts: state.attempts,
      history: state.history,
      canRetry: state.canRetry,
      traits: M.TRAITS,
      species: M.SPECIES,
    };
  }

  /** 写需求 → 出候选。 */
  async seek(input = {}) {
    if (this._state().status === 'dating') {
      return { ok: false, code: 'DATING', message: '已经在谈了，先好好谈。' };
    }
    const desire = M.parseDesire(input);
    const exclude = this._state().history.filter((h) => h.kind === 'propose').map((h) => h.id);
    let candidates = [];
    let source = 'local';
    const endpoint = this.endpoint();
    if (endpoint) {
      try {
        candidates = await this._remote(desire, exclude);
        if (candidates.length) source = 'remote';
      } catch {
        candidates = [];
      }
    }
    if (!candidates.length) {
      const day = new Date(this.now()).toISOString().slice(0, 10);
      candidates = M.makeCandidates({ seed: `${this.seed()}#${day}`, count: 4, exclude });
    }
    const state = M.seek(this._state(), input, candidates, this.now());
    const snap = this._commit(state);
    return Object.assign({ ok: true, source }, snap);
  }

  async _remote(desire, exclude) {
    if (typeof this.fetchImpl !== 'function') return [];
    const base = this.endpoint().replace(/\/+$/, '');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
    try {
      const res = await this.fetchImpl(`${base}/match`, {
        method: 'POST',
        signal: ctl ? ctl.signal : undefined,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ desire, exclude }),
      });
      if (!res.ok) return [];
      const body = await res.json();
      const list = Array.isArray(body && body.candidates) ? body.candidates : [];
      return list
        .filter((c) => c && c.id && c.traits)
        .slice(0, 6)
        .map((c) => ({
          id: String(c.id).slice(0, 40),
          name: String(c.name || '一只').slice(0, 12),
          species: String(c.species || 'cube').slice(0, 16),
          speciesLabel: String(c.speciesLabel || '方块仔').slice(0, 16),
          emoji: String(c.emoji || '🧊').slice(0, 4),
          art: String(c.art || 'cube').slice(0, 16),
          traits: c.traits,
          bio: String(c.bio || '').slice(0, 120),
          wants: Array.isArray(c.wants) ? c.wants.slice(0, 2).map((w) => String(w).slice(0, 40)) : [],
          steps: Math.max(0, Math.min(999, Number(c.steps) || 0)),
          remote: true,
        }));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  propose(id) {
    const r = M.propose(this._state(), String(id || ''), this.now());
    if (!r.ok) return r;
    const snap = this._commit(r.state);
    return Object.assign({ ok: true, reply: r.reply }, snap);
  }

  retry() {
    const r = M.retry(this._state(), this.now());
    if (!r.ok) return r;
    const snap = this._commit(r.state);
    return Object.assign({ ok: true, reply: r.reply }, snap);
  }

  confirm(opts = {}) {
    const r = M.confirm(this._state(), { acceptPact: !!opts.acceptPact, now: this.now() });
    if (!r.ok) return r;
    const snap = this._commit(r.state);
    this.emit('dating', snap.relation);
    return snap;
  }

  breakup() {
    const r = M.breakup(this._state(), this.now());
    if (!r.ok) return r;
    const snap = this._commit(r.state);
    this.emit('single', snap);
    return snap;
  }

  reset() {
    const snap = this._commit(M.blank());
    return snap;
  }

  /** 桌宠气泡用。 */
  line() {
    return M.lineOf(this._state(), Math.random);
  }

  isDating() {
    return this._state().status === 'dating';
  }
}

module.exports = { MateService, FILE_DEFAULTS };
