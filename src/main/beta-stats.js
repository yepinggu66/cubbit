'use strict';

/**
 * 内测埋点（本地优先，不上传）。
 *
 * 只记录事件名 + 时间 + 少量非敏感字段，追加写入 <userData>/beta-events.jsonl（512KB 滚动）。
 * 用途：统计《商业价值评估》§6 内测方案里的三个核心指标——
 *   1) 双人同日活跃（Shared Day）：两台设备的 app_open 按天对齐；
 *   2) 配对成功率：pair_success / app_open 首日；
 *   3) 互动密度：msg_in / interaction_in 的日均次数。
 *
 * 导出方式：%APPDATA%\\Cubbit\\beta-events.jsonl，直接发给开发者汇总即可。
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 512 * 1024;

class BetaStats {
  constructor({ dir, version = '', installId = '', now = Date.now } = {}) {
    this.dir = dir || '';
    this.version = String(version || '');
    this.installId = String(installId || '').slice(0, 12);
    this.now = now;
    this.file = this.dir ? path.join(this.dir, 'beta-events.jsonl') : '';
  }

  filePath() { return this.file; }

  log(event, data = {}) {
    if (!this.file || !event) return null;
    const at = this.now();
    const dt = new Date(at);
    // 用本地日期而不是 UTC：中文用户早上 7 点的事件按 UTC 会落到前一天，
    // 会直接污染「双人同日活跃（Shared Day）」这个核心指标。
    const day = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const entry = {
      t: at,
      day,
      event: String(event),
      v: this.version,
      i: this.installId,
      ...data,
    };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      try {
        if (fs.statSync(this.file).size > MAX_BYTES) fs.renameSync(this.file, `${this.file}.1`);
      } catch { /* 首次写入 */ }
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch { return null; }
    return entry;
  }

  /** 读回本地事件（给「关于」页/诊断用） */
  tail(limit = 500) {
    if (!this.file) return [];
    try {
      return fs.readFileSync(this.file, 'utf8').trim().split('\n').slice(-Math.max(1, limit)).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }
}

module.exports = { BetaStats };
