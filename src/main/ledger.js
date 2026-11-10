/**
 * 人生账本（Ledger）——把《性价比人生》接到桌面宠物上。
 *
 * 分工：
 *   shared/lifegame.js  纯逻辑（可 node 单测）：抽卡、结算、结局、台词
 *   main/ledger.js      持久化 + 每日节奏 + 事件（本文件）
 *   renderer/ledger/    牌桌界面
 *
 * 为什么放在主进程：一天只能走一步，这是产品的核心承诺。
 * 如果判定放在渲染层，改一下系统时间或重开面板就能刷回合，承诺立刻失效。
 * 所以"今天能不能玩"只由这里回答，渲染层拿到的只是结果。
 */
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { app } = require('electron');
const { JsonFile } = require('./json-file');
const Game = require('../shared/lifegame');

class Ledger extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.filePath = opts.filePath || path.join(app.getPath('userData'), 'lifegame.json');
    this.game = new JsonFile(this.filePath, { version: Game.VERSION, state: Game.create() });
    this.game.load();
  }

  state() {
    return Game.normalize(this.game.get('state'));
  }

  _save(state) {
    this.game.patch({ state, version: Game.VERSION });
    return state;
  }

  /** 面板首屏：今天的三张卡 + 是否已经走过这一步。 */
  snapshot(now) {
    const state = this.state();
    const cards = state.ended ? [] : Game.cardsFor(state, now);
    return {
      ok: true,
      state: Game.snapshot(state, now),
      cards: cards.map((c) => ({
        id: c.id,
        secName: c.secName,
        title: c.title,
        plain: c.plain,
        ev: c.ev,
        money: c.money,
        time: c.time,
        will: c.will,
        channel: Game.channelOf(c),
      })),
    };
  }

  /** 走一步。执行或放弃。 */
  choose(cardId, action, now) {
    const before = this.state();
    const act = action === 'skip' ? 'skip' : 'do';
    const { state, result } = Game.choose(before, String(cardId || ''), act, now);

    if (!result.ok) {
      const msg = {
        ALREADY_TODAY: '今天就到这儿了，明天再来。',
        ENDED: '这一局已经结束了。',
        NO_CARD: '这张卡不在今天的牌里。',
        NOT_TODAY_CARD: '这张卡不在今天的牌里。',
      };
      return { ok: false, code: result.code, message: msg[result.code] || '这一步没走成。' };
    }

    // 连续天数：昨天走过就 +1，否则从 1 重新数。
    state.streak = this._nextStreak(before, now);
    const saved = this._save(state);

    const payload = {
      ok: true,
      state: Game.snapshot(saved, now),
      result: {
        card: result.card,
        action: result.action,
        deltas: result.deltas,
        event: result.event,
        line: result.line,
        factor: result.factor,
        passing: result.passing,
        ended: result.ended,
        owner: result.owner,
      },
    };
    this.emit('turn', payload);
    this.emit('mood', Game.resourceMood(saved));
    return payload;
  }

  _nextStreak(before, now) {
    const today = Game.todayKey(now);
    const yesterday = Game.todayKey(new Date(Date.now() - 86400000));
    if (!before.lastPlayDay) return 1;
    if (before.lastPlayDay === yesterday) return (before.streak || 0) + 1;
    if (before.lastPlayDay === today) return before.streak || 1;
    return 1;
  }

  /** 死亡/终局后重开一条命。历史不清，用来做"上一世"的对照。 */
  restart(now) {
    const prev = this.state();
    const fresh = Game.create(now, prev.duo.on ? { duo: { names: prev.duo.names } } : {});
    fresh.lifeIndex = (prev.lifeIndex || 1) + 1;
    fresh.used = prev.used.slice(-120); // 记忆：抽过的卡别立刻重复出现
    this._save(fresh);
    this.emit('mood', Game.resourceMood(fresh));
    return { ok: true, state: Game.snapshot(fresh, now) };
  }

  /** 它今天的样子（毛色 / 待机速度），由四条资源决定。 */
  mood(now) {
    return Game.resourceMood(this.state(), now);
  }

  // ---------------------------------------------------------------- 同命局

  /** 开一局同命局：四十步两人轮流按，共用一条命。 */
  startDuo(names, now) {
    const cur = this.state();
    if (cur.ended) return { ok: false, code: 'ENDED', message: '这一局已经结束了，先开新的一条命。' };
    if (cur.turn > 0) return { ok: false, code: 'STARTED', message: '这一局已经走过了，同命局只能从第一天开始。' };
    const list = Array.isArray(names) && names.length === 2 ? names : ['你', 'TA'];
    const next = Game.normalize({ ...cur, duo: { on: true, names: list, since: Game.todayKey(now) } });
    this._save(next);
    this.emit('duo', Game.duoInfo(next));
    return { ok: true, state: Game.snapshot(next, now) };
  }

  stopDuo(now) {
    const cur = this.state();
    const next = Game.normalize({ ...cur, duo: { on: false, names: cur.duo.names, since: null } });
    this._save(next);
    this.emit('duo', null);
    return { ok: true, state: Game.snapshot(next, now) };
  }

  /** 把今天这一手打包成一段可带到手机上的码（只有三张卡，不含整局状态）。 */
  hand(now) {
    const state = this.state();
    const cards = state.ended ? [] : Game.cardsFor(state, now);
    if (!cards.length) return { ok: false, code: 'NO_HAND', message: '今天没有可看的牌。' };
    return {
      ok: true,
      code: Game.packHand(state, cards, now),
      turn: state.turn,
      day: Game.todayKey(now),
      canPlay: Game.needsDay(state, now),
    };
  }

  /** 宠物那句提醒：今天还没走，就催一句；已经走过，就说结果。 */
  nudge(now) {
    const state = this.state();
    if (state.ended) return null;
    if (!Game.needsDay(state, now)) return null;
    const cards = Game.cardsFor(state, now);
    if (!cards.length) return null;
    if (state.duo.on) {
      const who = state.duo.names[state.turn % 2];
      return `今天轮到「${who}」按这一步。第 ${state.turn + 1}/40 步，我陪着。`;
    }
    return `今天有 3 张卡等你看。第 ${state.turn + 1}/40 步，我陪你选。`;
  }
}

module.exports = { Ledger };
