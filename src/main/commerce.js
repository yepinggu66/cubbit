/**
 * 商城交易客户端（主进程侧）：下单、查单、优惠券校验。
 * 用 Node 内置 fetch，不引入额外依赖；离线时返回结构化错误而不是抛异常。
 */
class CommerceClient {
  constructor(getBaseUrl) {
    this.getBaseUrl = getBaseUrl;
    this._orders = new Map(); // 本地缓存，降低轮询对服务端的压力
  }

  base() {
    return (this.getBaseUrl() || '').replace(/\/+$/, '');
  }

  async request(path, { method = 'GET', body } = {}) {
    const url = `${this.base()}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, status: res.status, code: data.code || 'HTTP_ERROR', message: data.message || `请求失败（HTTP ${res.status}）` };
      }
      return { ok: true, ...data };
    } catch (err) {
      const offline = err && (err.name === 'AbortError' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND');
      return {
        ok: false,
        offline: !!offline,
        code: offline ? 'SERVER_OFFLINE' : 'NETWORK_ERROR',
        message: offline ? '无法连接许可服务器，请检查网络或服务器是否已启动' : `网络错误：${err.message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async createOrder({ planId, couponCode, email, deviceId }) {
    const res = await this.request('/api/orders', { method: 'POST', body: { planId, couponCode, email, deviceId } });
    if (res.ok && res.order) this._orders.set(res.order.id, res.order);
    return res;
  }

  async getOrder(orderId) {
    const res = await this.request(`/api/orders/${encodeURIComponent(orderId)}`);
    if (res.ok && res.order) this._orders.set(res.order.id, res.order);
    return res;
  }

  async validateCoupon(code, planId) {
    return this.request('/api/coupons/validate', { method: 'POST', body: { code, planId } });
  }

  async ping() {
    return this.request('/api/health');
  }
}

module.exports = { CommerceClient };
