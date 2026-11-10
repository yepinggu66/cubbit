/**
 * 极简 JSON 持久化：原子写（临时文件 + rename）+ 内存缓存 + 变更事件。
 * 所有用户数据（设置、专注统计、成长、许可缓存）都用它落盘。
 */
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class JsonFile extends EventEmitter {
  /**
   * @param {string} filePath 绝对路径
   * @param {object} defaults 默认值（深拷贝后作为初始内容）
   */
  constructor(filePath, defaults = {}) {
    super();
    this.filePath = filePath;
    this.defaults = JSON.parse(JSON.stringify(defaults));
    this.data = null;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { ...this.defaults, ...parsed };
    } catch {
      this.data = JSON.parse(JSON.stringify(this.defaults));
      this._write();
    }
    return this.data;
  }

  ensureDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  _write() {
    this.ensureDir();
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  save() {
    if (!this.data) return;
    try {
      this._write();
    } catch (err) {
      // 磁盘只读等极端情况：不因为持久化失败而崩溃
      console.error('[JsonFile] save failed', this.filePath, err && err.message);
    }
    return this.data;
  }

  get(key) {
    return key === undefined ? this.data : this.data[key];
  }

  patch(partial) {
    if (!this.data) this.load();
    const before = JSON.stringify(this.data);
    this.data = { ...this.data, ...partial };
    if (JSON.stringify(this.data) !== before) {
      this.save();
      this.emit('changed', this.data, partial);
    }
    return this.data;
  }

  /**
   * 删除某个键并落盘。
   * 用于强制清除历史遗留字段（如已下线的 developerMode），确保「读取时忽略、写入时不保留」。
   * @param {string} key
   * @returns {boolean} 是否真的删除了
   */
  remove(key) {
    if (!this.data) this.load();
    if (!this.data || !(key in this.data)) return false;
    const next = { ...this.data };
    delete next[key];
    this.data = next;
    this.save();
    this.emit('changed', this.data, { [key]: undefined });
    return true;
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(this.defaults));
    this.save();
    this.emit('changed', this.data, this.data);
    return this.data;
  }
}

module.exports = { JsonFile };
