'use strict';

/**
 * Stripe 测试模式结账（仅 sk_test_ / pk_test_）。
 *
 * 桌面应用里 Google Pay 走 Stripe 托管 Checkout（checkout.stripe.com）：
 * Stripe 是收款方，不在本仓库登记 Google merchant id。
 * 不传 payment_method_types，让 Dashboard 测试模式下已打开的 Google Pay 出现在结账页。
 *
 * 人民币标价（catalog.price / offer-config）不在这里改。
 * Google Pay 不支持把 CNY 当作展示币种，所以测试扣款使用目录里已经公布的 priceUsd，
 * 付费墙情侣包使用 lite-config 上已经展示的美元价格。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { PLANS, DLC } = require('../shared/catalog');
const liteConfig = require('../shared/lite-config');

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';
const DEFAULT_PORT = 8788;
const WEBHOOK_TOLERANCE_SEC = 300;

function classifyStripeEnv(env) {
  const source = env || {};
  const secret = String(source.STRIPE_SECRET_KEY || '').trim();
  const publishable = String(source.STRIPE_PUBLISHABLE_KEY || '').trim();
  const webhookSecret = String(source.STRIPE_WEBHOOK_SECRET || '').trim();
  const flagOn = String(source.CUBBIT_STRIPE_TEST || '').trim() === '1';

  // 测试开关关闭时，环境里残留的 live / test 密钥都不介入商店。
  // 原来的许可服务下单继续走，不能因为 sk_live_ 把整条结账挡住。
  if (!flagOn) {
    return {
      enabled: false,
      blockCheckout: false,
      code: 'TEST_MODE_OFF',
      secret: '',
      publishable: '',
      webhookSecret: '',
      message: '',
    };
  }

  const liveSecret = secret.startsWith('sk_live_');
  const livePublishable = publishable.startsWith('pk_live_');
  if (liveSecret || livePublishable) {
    return {
      enabled: false,
      blockCheckout: true,
      code: 'LIVE_KEY_REJECTED',
      secret: '',
      publishable: '',
      webhookSecret: '',
      message: '检测到 live 密钥。本版本只允许 Stripe 测试模式，已拒绝结账，不会发起真实扣款。',
    };
  }
  if (flagOn && !secret.startsWith('sk_test_')) {
    return {
      enabled: false,
      blockCheckout: true,
      code: 'TEST_KEY_REQUIRED',
      secret: '',
      publishable: '',
      webhookSecret: '',
      message: '已设置 CUBBIT_STRIPE_TEST=1，但 STRIPE_SECRET_KEY 不是 sk_test_ 开头。为避免误打生产接口，结账已关闭。',
    };
  }
  if (flagOn && publishable && !publishable.startsWith('pk_test_')) {
    return {
      enabled: false,
      blockCheckout: true,
      code: 'PUBLISHABLE_KEY_INVALID',
      secret: '',
      publishable: '',
      webhookSecret: '',
      message: 'STRIPE_PUBLISHABLE_KEY 必须是 pk_test_ 开头。不使用 Payment Element 时可以不设置它。',
    };
  }
  if (flagOn && secret.startsWith('sk_test_')) {
    return {
      enabled: true,
      blockCheckout: false,
      code: 'TEST_MODE',
      secret,
      publishable,
      webhookSecret,
      message: '',
    };
  }
  return {
    enabled: false,
    blockCheckout: false,
    code: 'TEST_MODE_OFF',
    secret: '',
    publishable: '',
    webhookSecret: '',
    message: '',
  };
}

function returnPort(env) {
  const n = Number(env && env.CUBBIT_STRIPE_RETURN_PORT);
  if (Number.isInteger(n) && n >= 1024 && n <= 65535) return n;
  return DEFAULT_PORT;
}

function formatMinor(amount, currency) {
  const cur = String(currency || 'usd').toLowerCase();
  const text = (Number(amount) / 100).toFixed(2);
  if (cur === 'usd') return `$${text}`;
  return `${cur.toUpperCase()} ${text}`;
}

function fail(code, message) {
  return { ok: false, code, message };
}

/** 真正要调用 Stripe 之前的最后一道闸：live 密钥不能被发出去。 */
function liveCredentialError(env) {
  const source = env || {};
  const secret = String(source.STRIPE_SECRET_KEY || '').trim();
  const publishable = String(source.STRIPE_PUBLISHABLE_KEY || '').trim();
  if (secret.startsWith('sk_live_') || publishable.startsWith('pk_live_')) {
    return fail('LIVE_KEY_REJECTED', '检测到 live 密钥。测试结账不会使用它，也不会发起真实扣款。');
  }
  return null;
}

function resolveSku(planId, now) {
  const id = String(planId || '').trim();
  const when = Number.isFinite(now) ? now : Date.now();
  const dlc = (DLC || []).find((item) => item.id === id);
  if (dlc) {
    if (dlc.available === false) {
      return fail(
        'PLAN_UNAVAILABLE',
        dlc.includedInBase ? `「${dlc.name}」已包含在完整版中，请直接购买完整版` : `「${dlc.name}」已下架`,
      );
    }
    if (!Number.isInteger(dlc.priceUsd) || dlc.priceUsd <= 0) {
      return fail('PRICE_USD_MISSING', `「${dlc.name}」没有目录美元价，测试结账已停止。`);
    }
    return {
      ok: true,
      sku: {
        id: dlc.id,
        name: `方块仔 ${dlc.name}`,
        amount: dlc.priceUsd,
        currency: 'usd',
        mode: 'payment',
        interval: null,
        priceSource: 'catalog.priceUsd',
        catalogPriceCny: dlc.price,
      },
    };
  }

  const plan = (PLANS || []).find((item) => item.id === id);
  if (plan) {
    if (!Number.isInteger(plan.priceUsd) || plan.priceUsd <= 0) {
      return fail('PRICE_USD_MISSING', `「${plan.name}」没有目录美元价，测试结账已停止。`);
    }
    const recurring = plan.period === 'month' || plan.period === 'year';
    return {
      ok: true,
      sku: {
        id: plan.id,
        name: `方块仔 ${plan.name}`,
        amount: plan.priceUsd,
        currency: 'usd',
        mode: recurring ? 'subscription' : 'payment',
        interval: recurring ? plan.period : null,
        priceSource: 'catalog.priceUsd',
        catalogPriceCny: plan.price,
      },
    };
  }

  if (id === 'lite_couple' || id === 'couple_pack') {
    const dollars = Number(liteConfig.currentPrice(when));
    const amount = Math.round(dollars * 100);
    if (!Number.isInteger(amount) || amount <= 0) {
      return fail('PRICE_USD_MISSING', '付费墙价格无效，测试结账已停止。');
    }
    return {
      ok: true,
      sku: {
        id: 'lite_couple',
        name: liteConfig.productNameZh || '情侣包',
        amount,
        currency: 'usd',
        mode: 'payment',
        interval: null,
        priceSource: 'lite-config',
        catalogPriceCny: null,
      },
    };
  }

  return fail('PLAN_NOT_FOUND', '请选择有效的方案');
}

function buildCheckoutForm({ orderId, sku, email, successUrl, cancelUrl, deviceId }) {
  const form = new URLSearchParams();
  form.set('mode', sku.mode);
  form.set('success_url', successUrl);
  form.set('cancel_url', cancelUrl);
  form.set('client_reference_id', orderId);
  form.set('metadata[cubbit_order_id]', orderId);
  form.set('metadata[cubbit_plan_id]', sku.id);
  form.set('metadata[cubbit_env]', 'test');
  form.set('metadata[cubbit_price_source]', sku.priceSource);
  if (deviceId) form.set('metadata[cubbit_device_id]', String(deviceId).slice(0, 80));
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', sku.currency);
  form.set('line_items[0][price_data][unit_amount]', String(sku.amount));
  form.set('line_items[0][price_data][product_data][name]', sku.name);
  form.set('line_items[0][price_data][product_data][metadata][sku]', sku.id);
  if (sku.mode === 'subscription') {
    form.set('line_items[0][price_data][recurring][interval]', sku.interval);
  }
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) form.set('customer_email', email);
  return form;
}

function isStripeCheckoutUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'checkout.stripe.com';
  } catch {
    return false;
  }
}

function inspectSession(data) {
  if (!data || typeof data !== 'object') {
    return fail('STRIPE_BAD_RESPONSE', 'Stripe 没有返回结账会话。');
  }
  const id = String(data.id || '');
  if (data.livemode !== false || id.startsWith('cs_live_')) {
    return fail('LIVE_SESSION_REJECTED', '拒绝处理 live 模式的 Checkout Session，不会入账。');
  }
  if (!id.startsWith('cs_test_')) {
    return fail('STRIPE_NOT_TEST_SESSION', 'Stripe 没有返回测试模式 Checkout Session。');
  }
  const rawIntent = data.payment_intent;
  const paymentIntent = typeof rawIntent === 'string' ? rawIntent : (rawIntent && rawIntent.id) || '';
  if (paymentIntent && !String(paymentIntent).startsWith('pi_')) {
    return fail('STRIPE_BAD_RESPONSE', '支付意图编号异常。');
  }
  const rawSub = data.subscription;
  const subscription = typeof rawSub === 'string' ? rawSub : (rawSub && rawSub.id) || '';
  return {
    ok: true,
    id,
    url: data.url || '',
    livemode: false,
    paymentIntent,
    subscription,
    paymentStatus: data.payment_status || '',
    status: data.status || '',
    paid: data.payment_status === 'paid',
  };
}

function redact(text) {
  return String(text || '')
    .replace(/sk_live_[A-Za-z0-9_]+/g, 'sk_live_[redacted]')
    .replace(/sk_test_[A-Za-z0-9_]+/g, 'sk_test_[redacted]')
    .replace(/pk_live_[A-Za-z0-9_]+/g, 'pk_live_[redacted]')
    .replace(/pk_test_[A-Za-z0-9_]+/g, 'pk_test_[redacted]')
    .replace(/whsec_[A-Za-z0-9_]+/g, 'whsec_[redacted]');
}

function verifyStripeSignature(secret, payload, header, nowMs, toleranceSec) {
  if (!secret) {
    return fail('WEBHOOK_UNSIGNED', '未配置 STRIPE_WEBHOOK_SECRET，已忽略未签名的 webhook。');
  }
  const tolerance = Number.isFinite(toleranceSec) ? toleranceSec : WEBHOOK_TOLERANCE_SEC;
  const parts = String(header || '').split(',').map((part) => part.trim()).filter(Boolean);
  const stampPart = parts.find((part) => part.startsWith('t='));
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (!stampPart || !signatures.length) {
    return fail('WEBHOOK_BAD_SIGNATURE', 'webhook 签名无法识别。');
  }
  const timestamp = Number(stampPart.slice(2));
  if (!Number.isFinite(timestamp)) return fail('WEBHOOK_BAD_SIGNATURE', 'webhook 签名无法识别。');
  const nowSec = (Number.isFinite(nowMs) ? nowMs : Date.now()) / 1000;
  if (Math.abs(nowSec - timestamp) > tolerance) {
    return fail('WEBHOOK_TIMESTAMP', 'webhook 时间戳超出允许范围。');
  }
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const match = signatures.some((sig) => {
    const got = Buffer.from(String(sig), 'utf8');
    return got.length === expectedBuf.length && crypto.timingSafeEqual(got, expectedBuf);
  });
  if (!match) return fail('WEBHOOK_BAD_SIGNATURE', 'webhook 签名不匹配。');
  return { ok: true };
}

function quoteFor(sku) {
  return {
    amount: sku.amount,
    currency: sku.currency,
    amountText: formatMinor(sku.amount, sku.currency),
    mode: sku.mode,
    interval: sku.interval,
    priceSource: sku.priceSource,
  };
}

function decorateSellables(items, env, now) {
  const list = Array.isArray(items) ? items : [];
  const gate = classifyStripeEnv(env || {});
  if (!gate.enabled) return list.map((item) => ({ ...item }));
  const when = Number.isFinite(now) ? now : Date.now();
  return list.map((item) => {
    const resolved = resolveSku(item && item.id, when);
    if (!resolved.ok) return { ...item };
    return { ...item, stripeTestQuote: quoteFor(resolved.sku) };
  });
}

function publicOrder(order) {
  return {
    id: order.id,
    planId: order.planId,
    amount: order.amount,
    currency: order.currency,
    amountText: order.amountText,
    status: order.status,
    payUrl: order.payUrl,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    testMode: true,
    livemode: false,
    stripeCheckoutSessionId: order.stripeCheckoutSessionId || '',
    stripePaymentIntentId: order.stripePaymentIntentId || '',
    stripeSubscriptionId: order.stripeSubscriptionId || '',
    priceSource: order.priceSource || '',
    mode: order.mode || 'payment',
  };
}

class OrderLedger {
  constructor(file) {
    this.file = file;
    this.orders = new Map();
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const order of raw.orders || []) {
        if (order && order.id) this.orders.set(order.id, order);
      }
    } catch {
      /* 还没有账本 */
    }
  }

  get(id) {
    return this.orders.get(id) || null;
  }

  upsert(order) {
    this.orders.set(order.id, order);
    const body = JSON.stringify({ orders: [...this.orders.values()] }, null, 2);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, this.file);
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

class StripeTestCheckout {
  /**
   * @param {{env?:object, orderFile?:string, userDataDir?:string, returnBase?:string,
   *          now?:Function, fetchImpl?:Function, port?:number}} [options]
   */
  constructor(options) {
    const opts = options || {};
    this.env = opts.env || process.env;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this.returnBase = opts.returnBase || `http://127.0.0.1:${returnPort(this.env)}`;
    const dir = opts.userDataDir || path.join(os.homedir(), '.cubbit');
    this.orderFile = opts.orderFile || path.join(dir, 'stripe-test-orders.json');
    this.ledger = new OrderLedger(this.orderFile);
    this._server = null;
  }

  gate() {
    return classifyStripeEnv(this.env);
  }

  status() {
    const gate = this.gate();
    return {
      enabled: gate.enabled,
      blockCheckout: gate.blockCheckout,
      code: gate.code,
      message: gate.message,
      mode: 'test',
      provider: 'stripe',
      wallets: gate.enabled ? ['google_pay'] : [],
      productionCharging: false,
      priceNote: gate.enabled
        ? '测试扣款使用目录中已有的美元价（catalog.priceUsd）；付费墙情侣包使用 lite-config 上显示的价格。人民币标价未改。'
        : '',
    };
  }

  decorateSellables(items) {
    return decorateSellables(items, this.env, this.now());
  }

  hasOrder(orderId) {
    return !!this.ledger.get(String(orderId || ''));
  }

  getOrder(orderId) {
    return this.ledger.get(String(orderId || ''));
  }

  async createCheckout({ planId, email, deviceId, couponCode } = {}) {
    const gate = this.gate();
    if (!gate.enabled) {
      return fail(gate.code || 'TEST_MODE_OFF', gate.message || 'Stripe 测试结账未开启。');
    }
    if (couponCode && String(couponCode).trim()) {
      return fail('COUPON_UNSUPPORTED_IN_TEST', 'Stripe 测试结账按目录原价收款，请先清空优惠码。测试路径不会把优惠码发给生产服务器。');
    }
    const resolved = resolveSku(planId, this.now());
    if (!resolved.ok) return resolved;
    if (typeof this.fetchImpl !== 'function') {
      return fail('NETWORK_ERROR', '当前环境不能请求 Stripe。');
    }

    const orderId = `ord_test_${crypto.randomBytes(8).toString('hex')}`;
    const sku = resolved.sku;
    const successUrl = `${this.returnBase}/stripe-test/return?order_id=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${this.returnBase}/stripe-test/cancel?order_id=${encodeURIComponent(orderId)}`;
    const form = buildCheckoutForm({
      orderId,
      sku,
      email: email ? String(email).trim() : '',
      successUrl,
      cancelUrl,
      deviceId,
    });

    const liveKey = liveCredentialError(this.env);
    if (liveKey) return liveKey;

    let response;
    try {
      response = await this.fetchImpl(STRIPE_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gate.secret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': orderId,
        },
        body: form,
      });
    } catch (err) {
      return fail('NETWORK_ERROR', `无法连接 Stripe：${redact(err && err.message)}`);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error && data.error.message;
      return fail('STRIPE_ERROR', redact(message || `Stripe 拒绝了这次结账（HTTP ${response.status}）`));
    }
    const session = inspectSession(data);
    if (!session.ok) return session;
    if (!isStripeCheckoutUrl(session.url)) {
      return fail('STRIPE_BAD_URL', 'Stripe 没有返回托管结账链接。');
    }

    const createdAt = Math.floor(this.now() / 1000);
    const order = {
      id: orderId,
      planId: sku.id,
      amount: sku.amount,
      currency: sku.currency,
      amountText: formatMinor(sku.amount, sku.currency),
      status: 'pending',
      payUrl: session.url,
      createdAt,
      expiresAt: createdAt + 30 * 60,
      testMode: true,
      livemode: false,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: session.paymentIntent || '',
      stripeSubscriptionId: session.subscription || '',
      priceSource: sku.priceSource,
      catalogPriceCny: sku.catalogPriceCny,
      mode: sku.mode,
      email: email ? String(email).trim() : '',
      deviceId: deviceId ? String(deviceId) : '',
    };
    this.ledger.upsert(order);
    return { ok: true, order: publicOrder(order) };
  }

  async syncOrder(orderId) {
    const order = this.ledger.get(String(orderId || ''));
    if (!order) return fail('ORDER_NOT_FOUND', '订单不存在或已过期');
    const gate = this.gate();
    if (!gate.enabled || !order.stripeCheckoutSessionId) return { ok: true, order: publicOrder(order) };
    const liveKey = liveCredentialError(this.env);
    if (liveKey) return liveKey;

    let response;
    try {
      response = await this.fetchImpl(`${STRIPE_API}/${encodeURIComponent(order.stripeCheckoutSessionId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${gate.secret}` },
      });
    } catch (err) {
      return fail('NETWORK_ERROR', `无法向 Stripe 核对订单：${redact(err && err.message)}`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error && data.error.message;
      return fail('STRIPE_ERROR', redact(message || `核对订单失败（HTTP ${response.status}）`));
    }
    const session = inspectSession(data);
    if (!session.ok) return session;
    if (session.id !== order.stripeCheckoutSessionId) {
      return fail('SESSION_MISMATCH', 'Stripe 返回的会话与本地订单不一致，未入账。');
    }
    this._applySession(order, session);
    this.ledger.upsert(order);
    return { ok: true, order: publicOrder(order) };
  }

  _applySession(order, session) {
    if (session.paymentIntent) order.stripePaymentIntentId = session.paymentIntent;
    if (session.subscription) order.stripeSubscriptionId = session.subscription;
    if (session.paid) {
      order.status = 'paid';
      order.paidAt = Math.floor(this.now() / 1000);
      return;
    }
    if (session.status === 'expired' && order.status !== 'paid') {
      order.status = 'expired';
      return;
    }
    // 用户打开过取消页，但 Stripe 会话仍可支付。本地不能停在 cancelled。
    if (order.status === 'cancelled') order.status = 'pending';
  }

  handleWebhook(rawBody, header, nowMs) {
    const gate = this.gate();
    const verified = verifyStripeSignature(gate.webhookSecret, String(rawBody || ''), header, nowMs);
    if (!verified.ok) return verified;
    let event;
    try {
      event = JSON.parse(String(rawBody || ''));
    } catch {
      return fail('WEBHOOK_BAD_PAYLOAD', 'webhook 不是合法 JSON。');
    }
    if (!event || event.livemode !== false) {
      return fail('LIVE_SESSION_REJECTED', '拒绝处理 live 模式的 webhook，不会入账。');
    }
    const obj = event.data && event.data.object;
    if (!obj || typeof obj !== 'object') return fail('WEBHOOK_BAD_PAYLOAD', 'webhook 缺少会话数据。');
    const session = inspectSession(obj);
    if (!session.ok) return session;
    const orderId = (obj.metadata && obj.metadata.cubbit_order_id) || obj.client_reference_id || '';
    const order = this.ledger.get(String(orderId));
    if (!order) return fail('ORDER_NOT_FOUND', 'webhook 里的订单不在本地测试账本中。');
    if (order.stripeCheckoutSessionId && session.id !== order.stripeCheckoutSessionId) {
      return fail('SESSION_MISMATCH', 'webhook 会话与本地订单不一致，未入账。');
    }
    const type = String(event.type || '');
    if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
      if (!session.paid) return { ok: true, ignored: true, order: publicOrder(order) };
      this._applySession(order, session);
      this.ledger.upsert(order);
      return { ok: true, order: publicOrder(order) };
    }
    if (type === 'checkout.session.expired' && order.status !== 'paid') {
      order.status = 'expired';
      this.ledger.upsert(order);
      return { ok: true, order: publicOrder(order) };
    }
    return { ok: true, ignored: true, order: publicOrder(order) };
  }

  startReturnServer(options) {
    const gate = this.gate();
    if (!gate.enabled) return Promise.resolve({ ok: false, skipped: true, code: gate.code, message: gate.message });
    if (this._server) {
      return Promise.resolve({ ok: true, base: this.returnBase });
    }
    const requested = options && Number.isInteger(options.port) ? options.port : returnPort(this.env);
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this._onReturn(req, res).catch((err) => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(redact(err && err.message));
        });
      });
      server.once('error', (err) => {
        resolve({ ok: false, code: 'RETURN_SERVER_ERROR', message: err && err.message ? err.message : '回跳服务启动失败' });
      });
      server.listen(requested, '127.0.0.1', () => {
        const addr = server.address();
        const port = addr && addr.port ? addr.port : requested;
        this.returnBase = `http://127.0.0.1:${port}`;
        this._server = server;
        resolve({ ok: true, base: this.returnBase, port });
      });
    });
  }

  stopReturnServer() {
    const server = this._server;
    this._server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  async _onReturn(req, res) {
    const host = String(req.headers.host || '127.0.0.1');
    const url = new URL(req.url || '/', `http://${host}`);
    if (req.method === 'GET' && url.pathname === '/stripe-test/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, mode: 'test', productionCharging: false }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/stripe-test/webhook') {
      const raw = await readBody(req);
      const result = this.handleWebhook(raw, req.headers['stripe-signature'], this.now());
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: !!result.ok, code: result.code || '', status: result.order ? result.order.status : '' }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/stripe-test/cancel') {
      const orderId = url.searchParams.get('order_id') || '';
      const existing = this.ledger.get(orderId);
      if (!existing) {
        writePage(res, '没有找到这张测试订单。', null);
        return;
      }
      // 取消页只是离开托管结账。会话在过期前仍可支付，不能记成终态取消。
      const synced = await this.syncOrder(orderId);
      const order = this.ledger.get(orderId) || existing;
      if (synced.ok && order.status === 'paid') {
        writePage(res, '这张测试订单已经支付，已入账。这是 Stripe 测试模式，没有真实扣款，也没有签发正式激活码。', order);
        return;
      }
      if (synced.ok && order.status === 'expired') {
        writePage(res, '这张 Stripe 结账会话已经过期，不能再支付。', order);
        return;
      }
      writePage(res, '结账页已关闭。这张订单仍可支付，商店会继续等待。', order);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/stripe-test/return') {
      const orderId = url.searchParams.get('order_id') || '';
      const sessionId = url.searchParams.get('session_id') || '';
      const existing = this.ledger.get(orderId);
      if (!existing) {
        writePage(res, '没有找到这张测试订单。', null);
        return;
      }
      if (sessionId && sessionId !== existing.stripeCheckoutSessionId) {
        writePage(res, '回跳里的会话和本地订单不一致，没有入账。', existing);
        return;
      }
      const synced = await this.syncOrder(orderId);
      const order = synced.ok ? synced.order : existing;
      if (synced.ok && order.status === 'paid') {
        writePage(res, '测试订单已入账。这是 Stripe 测试模式，没有真实扣款，也没有签发正式激活码。', order);
        return;
      }
      writePage(res, synced.ok ? 'Stripe 还没有把这张测试订单标成已支付。' : (synced.message || '暂时无法向 Stripe 核对订单。'), order);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('webhook body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function writePage(res, message, order) {
  const rows = order
    ? `<p>订单号：${escapeHtml(order.id)}</p>
       <p>状态：${escapeHtml(order.status)}</p>
       <p>Checkout Session：${escapeHtml(order.stripeCheckoutSessionId || '')}</p>
       <p>PaymentIntent：${escapeHtml(order.stripePaymentIntentId || '')}</p>
       <p>金额：${escapeHtml(order.amountText || '')}</p>`
    : '';
  const html = `<!doctype html><meta charset="utf-8"><title>方块仔 Stripe 测试结账</title>
    <body style="font-family:sans-serif;max-width:40rem;margin:2rem auto;line-height:1.5">
      <h1>方块仔 · Stripe 测试模式</h1>
      <p>${escapeHtml(message)}</p>
      ${rows}
      <p>可以关掉这个标签，回到方块仔。</p>
    </body>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

module.exports = {
  classifyStripeEnv,
  resolveSku,
  buildCheckoutForm,
  decorateSellables,
  formatMinor,
  inspectSession,
  verifyStripeSignature,
  isStripeCheckoutUrl,
  StripeTestCheckout,
};
