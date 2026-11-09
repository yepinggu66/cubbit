'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const stripe = require('../src/main/stripe-test');

const LAUNCH = Date.parse('2026-11-09T00:00:00Z');
const AFTER_LAUNCH = Date.parse('2027-01-02T00:00:00Z');

function env(overrides) {
  return Object.assign({
    CUBBIT_STRIPE_TEST: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_PUBLISHABLE_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
  }, overrides);
}

test('test checkout stays off unless the flag and an sk_test key are both set', () => {
  assert.equal(stripe.classifyStripeEnv(env({})).enabled, false);
  assert.equal(stripe.classifyStripeEnv(env({ STRIPE_SECRET_KEY: 'sk_test_abc' })).enabled, false);
  assert.equal(stripe.classifyStripeEnv(env({ STRIPE_SECRET_KEY: 'sk_test_abc' })).blockCheckout, false);
  const on = stripe.classifyStripeEnv(env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_test_abc' }));
  assert.equal(on.enabled, true);
  assert.equal(on.blockCheckout, false);
});

test('live keys are rejected only when test mode is explicitly on', () => {
  const secret = stripe.classifyStripeEnv(env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_live_nope' }));
  assert.equal(secret.enabled, false);
  assert.equal(secret.blockCheckout, true);
  assert.equal(secret.code, 'LIVE_KEY_REJECTED');
  const pub = stripe.classifyStripeEnv(env({
    CUBBIT_STRIPE_TEST: '1',
    STRIPE_SECRET_KEY: 'sk_test_abc',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_nope',
  }));
  assert.equal(pub.code, 'LIVE_KEY_REJECTED');
  assert.equal(pub.blockCheckout, true);
});

test('leftover live keys are ignored when test mode is off', () => {
  for (const leftover of [
    { STRIPE_SECRET_KEY: 'sk_live_leftover' },
    { STRIPE_PUBLISHABLE_KEY: 'pk_live_leftover' },
    { STRIPE_SECRET_KEY: 'sk_live_leftover', STRIPE_PUBLISHABLE_KEY: 'pk_live_leftover' },
  ]) {
    const gate = stripe.classifyStripeEnv(env(leftover));
    assert.equal(gate.enabled, false);
    assert.equal(gate.blockCheckout, false);
    assert.equal(gate.code, 'TEST_MODE_OFF');
    assert.equal(gate.secret, '');
    assert.equal(gate.publishable, '');
  }
});

test('create and sync do not send a live key to Stripe', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('should not call Stripe');
  };
  const blocked = new stripe.StripeTestCheckout({
    env: env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_live_nope' }),
    orderFile: path.join(os.tmpdir(), `cubbit-live-${process.pid}.json`),
    now: () => LAUNCH,
    fetchImpl,
  });
  const created = await blocked.createCheckout({ planId: 'base' });
  assert.equal(created.ok, false);
  assert.equal(created.code, 'LIVE_KEY_REJECTED');
  assert.equal(calls, 0);

  const dormant = new stripe.StripeTestCheckout({
    env: env({ STRIPE_SECRET_KEY: 'sk_live_leftover' }),
    orderFile: path.join(os.tmpdir(), `cubbit-dormant-${process.pid}.json`),
    now: () => LAUNCH,
    fetchImpl,
  });
  const off = await dormant.createCheckout({ planId: 'base' });
  assert.equal(off.ok, false);
  assert.equal(off.code, 'TEST_MODE_OFF');
  assert.equal(dormant.gate().blockCheckout, false);
  assert.equal(calls, 0);
});

test('a test flag without an sk_test key blocks checkout instead of falling through', () => {
  const gate = stripe.classifyStripeEnv(env({ CUBBIT_STRIPE_TEST: '1' }));
  assert.equal(gate.enabled, false);
  assert.equal(gate.blockCheckout, true);
  assert.equal(gate.code, 'TEST_KEY_REQUIRED');
});

test('base uses the catalog USD price and stays a one-time payment', () => {
  const res = stripe.resolveSku('base', LAUNCH);
  assert.equal(res.ok, true);
  assert.equal(res.sku.amount, 1999);
  assert.equal(res.sku.currency, 'usd');
  assert.equal(res.sku.mode, 'payment');
  assert.equal(res.sku.catalogPriceCny, 6800);
  assert.equal(res.sku.priceSource, 'catalog.priceUsd');
  assert.notEqual(res.sku.amount, 1800);
});

test('winter skin pack and AI month keep their catalog prices and billing mode', () => {
  const winter = stripe.resolveSku('dlc_season_winter', LAUNCH);
  assert.equal(winter.ok, true);
  assert.equal(winter.sku.amount, 499);
  assert.equal(winter.sku.mode, 'payment');
  const month = stripe.resolveSku('ai_month', LAUNCH);
  assert.equal(month.ok, true);
  assert.equal(month.sku.amount, 799);
  assert.equal(month.sku.mode, 'subscription');
  assert.equal(month.sku.interval, 'month');
});

test('retired DLC cannot be checked out', () => {
  const res = stripe.resolveSku('dlc_aurora', LAUNCH);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'PLAN_UNAVAILABLE');
});

test('paywall couple pack uses the lite-config price already shown on screen', () => {
  const launch = stripe.resolveSku('lite_couple', LAUNCH);
  assert.equal(launch.ok, true);
  assert.equal(launch.sku.amount, 1499);
  assert.equal(launch.sku.currency, 'usd');
  assert.equal(launch.sku.mode, 'payment');
  assert.equal(launch.sku.priceSource, 'lite-config');
  const later = stripe.resolveSku('lite_couple', AFTER_LAUNCH);
  assert.equal(later.sku.amount, 1999);
});

test('checkout form asks Stripe Checkout for dynamic payment methods and does not set a Google merchant id', () => {
  const sku = stripe.resolveSku('base', LAUNCH).sku;
  const form = stripe.buildCheckoutForm({
    orderId: 'ord_test_1',
    sku,
    email: 'owner@example.com',
    successUrl: 'http://127.0.0.1:8788/stripe-test/return?order_id=ord_test_1&session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'http://127.0.0.1:8788/stripe-test/cancel?order_id=ord_test_1',
  });
  const raw = form.toString();
  assert.equal(form.get('mode'), 'payment');
  assert.equal(form.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '1999');
  assert.equal(form.get('line_items[0][quantity]'), '1');
  assert.match(form.get('success_url'), /\{CHECKOUT_SESSION_ID\}/);
  assert.equal(form.get('metadata[cubbit_env]'), 'test');
  assert.equal(form.has('payment_method_types[0]'), false);
  assert.equal(raw.includes('payment_method_types'), false);
  assert.equal(raw.includes('merchant'), false);
  assert.equal(raw.includes('pk_live'), false);
  assert.equal(raw.includes('sk_live'), false);

  const sub = stripe.buildCheckoutForm({
    orderId: 'ord_test_sub',
    sku: stripe.resolveSku('ai_year', LAUNCH).sku,
    successUrl: 'http://127.0.0.1:8788/ok?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'http://127.0.0.1:8788/cancel',
  });
  assert.equal(sub.get('mode'), 'subscription');
  assert.equal(sub.get('line_items[0][price_data][recurring][interval]'), 'year');
  assert.equal(sub.get('line_items[0][price_data][unit_amount]'), '5999');
});

function sessionBody(overrides) {
  return Object.assign({
    id: 'cs_test_123',
    object: 'checkout.session',
    url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    livemode: false,
    payment_status: 'unpaid',
    status: 'open',
    payment_intent: null,
    subscription: null,
  }, overrides);
}

test('creating a checkout records a pending test order and never invents a license key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-stripe-'));
  const calls = [];
  const checkout = new stripe.StripeTestCheckout({
    env: env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_test_abc' }),
    orderFile: path.join(dir, 'orders.json'),
    returnBase: 'http://127.0.0.1:8788',
    now: () => LAUNCH,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => sessionBody(),
      };
    },
  });
  const res = await checkout.createCheckout({ planId: 'base', email: 'a@b.co', deviceId: 'dev_1' });
  assert.equal(res.ok, true);
  assert.equal(res.order.status, 'pending');
  assert.equal(res.order.testMode, true);
  assert.equal(res.order.livemode, false);
  assert.equal(res.order.amount, 1999);
  assert.equal(res.order.currency, 'usd');
  assert.equal(res.order.payUrl, 'https://checkout.stripe.com/c/pay/cs_test_123');
  assert.equal(res.order.stripeCheckoutSessionId, 'cs_test_123');
  assert.equal(res.order.licenseKey, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.match(calls[0].options.headers.Authorization, /^Bearer sk_test_/);
  assert.equal(String(calls[0].options.body).includes('payment_method_types'), false);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'orders.json'), 'utf8'));
  assert.equal(saved.orders[0].id, res.order.id);
  assert.equal(JSON.stringify(saved).includes('sk_test_'), false);
});

test('a live session or live key in the response is not stored as paid', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-stripe-'));
  const checkout = new stripe.StripeTestCheckout({
    env: env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_test_abc' }),
    orderFile: path.join(dir, 'orders.json'),
    returnBase: 'http://127.0.0.1:8788',
    now: () => LAUNCH,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => sessionBody({ id: 'cs_live_123', livemode: true, payment_status: 'paid' }),
    }),
  });
  const res = await checkout.createCheckout({ planId: 'base' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'LIVE_SESSION_REJECTED');
  assert.equal(fs.existsSync(path.join(dir, 'orders.json')), false);
});

test('syncing a paid test session records the payment intent and still has no license key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-stripe-'));
  const file = path.join(dir, 'orders.json');
  let phase = 'create';
  const checkout = new stripe.StripeTestCheckout({
    env: env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_test_abc' }),
    orderFile: file,
    returnBase: 'http://127.0.0.1:8788',
    now: () => LAUNCH,
    fetchImpl: async (url) => {
      if (phase === 'create') {
        return { ok: true, status: 200, json: async () => sessionBody() };
      }
      assert.match(url, /\/v1\/checkout\/sessions\/cs_test_123$/);
      return {
        ok: true,
        status: 200,
        json: async () => sessionBody({
          payment_status: 'paid',
          status: 'complete',
          payment_intent: 'pi_3abc',
        }),
      };
    },
  });
  const created = await checkout.createCheckout({ planId: 'dlc_season_winter' });
  phase = 'sync';
  const synced = await checkout.syncOrder(created.order.id);
  assert.equal(synced.ok, true);
  assert.equal(synced.order.status, 'paid');
  assert.equal(synced.order.stripePaymentIntentId, 'pi_3abc');
  assert.equal(synced.order.licenseKey, undefined);
  assert.equal(synced.order.testMode, true);
  assert.equal(synced.order.livemode, false);
});

test('webhook signature: valid test event marks paid, bad signature and livemode do not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-stripe-'));
  const secret = 'whsec_test_secret';
  const checkout = new stripe.StripeTestCheckout({
    env: env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: secret }),
    orderFile: path.join(dir, 'orders.json'),
    returnBase: 'http://127.0.0.1:8788',
    now: () => LAUNCH,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => sessionBody({ id: 'cs_test_hook' }) }),
  });
  const created = await checkout.createCheckout({ planId: 'base' });
  const payload = JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: sessionBody({
        id: 'cs_test_hook',
        client_reference_id: created.order.id,
        metadata: { cubbit_order_id: created.order.id },
        payment_status: 'paid',
        status: 'complete',
        payment_intent: 'pi_hook',
      }),
    },
  });
  const stamp = Math.floor(LAUNCH / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${stamp}.${payload}`).digest('hex');
  const header = `t=${stamp},v1=${sig}`;
  const good = checkout.handleWebhook(payload, header, LAUNCH);
  assert.equal(good.ok, true);
  assert.equal(checkout.getOrder(created.order.id).status, 'paid');
  assert.equal(checkout.getOrder(created.order.id).licenseKey, undefined);

  const tampered = checkout.handleWebhook(payload, `t=${stamp},v1=${'0'.repeat(64)}`, LAUNCH);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, 'WEBHOOK_BAD_SIGNATURE');

  const livePayload = payload.replace('"livemode":false', '"livemode":true');
  const liveSig = crypto.createHmac('sha256', secret).update(`${stamp}.${livePayload}`).digest('hex');
  const live = checkout.handleWebhook(livePayload, `t=${stamp},v1=${liveSig}`, LAUNCH);
  assert.equal(live.ok, false);
  assert.equal(live.code, 'LIVE_SESSION_REJECTED');
});

test('unsigned webhooks are ignored when no webhook secret is configured', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-stripe-'));
  const checkout = new stripe.StripeTestCheckout({
    env: env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_test_abc' }),
    orderFile: path.join(dir, 'orders.json'),
    returnBase: 'http://127.0.0.1:8788',
    now: () => LAUNCH,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => sessionBody() }),
  });
  const created = await checkout.createCheckout({ planId: 'base' });
  const res = checkout.handleWebhook(JSON.stringify({ type: 'checkout.session.completed', livemode: false }), '', LAUNCH);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'WEBHOOK_UNSIGNED');
  assert.equal(checkout.getOrder(created.order.id).status, 'pending');
});

test('coupons are not applied in the test path', async () => {
  const checkout = new stripe.StripeTestCheckout({
    env: env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_test_abc' }),
    orderFile: path.join(os.tmpdir(), 'unused-orders.json'),
    returnBase: 'http://127.0.0.1:8788',
    now: () => LAUNCH,
    fetchImpl: async () => { throw new Error('should not call Stripe'); },
  });
  const res = await checkout.createCheckout({ planId: 'base', couponCode: 'SAVE10' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'COUPON_UNSUPPORTED_IN_TEST');
});

test('localhost return page records a paid test session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-stripe-'));
  let phase = 'create';
  const checkout = new stripe.StripeTestCheckout({
    env: env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_test_abc' }),
    orderFile: path.join(dir, 'orders.json'),
    now: () => LAUNCH,
    fetchImpl: async (url) => {
      if (phase === 'create') return { ok: true, status: 200, json: async () => sessionBody() };
      assert.match(url, /\/v1\/checkout\/sessions\/cs_test_123$/);
      return {
        ok: true,
        status: 200,
        json: async () => sessionBody({ payment_status: 'paid', status: 'complete', payment_intent: 'pi_return' }),
      };
    },
  });
  const started = await checkout.startReturnServer({ port: 0 });
  assert.equal(started.ok, true);
  try {
    const created = await checkout.createCheckout({ planId: 'base' });
    phase = 'sync';
    const page = await fetch(`${started.base}/stripe-test/return?order_id=${encodeURIComponent(created.order.id)}&session_id=cs_test_123`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /测试订单已入账/);
    assert.match(html, /pi_return/);
    assert.equal(checkout.getOrder(created.order.id).status, 'paid');
    assert.equal(checkout.getOrder(created.order.id).licenseKey, undefined);
  } finally {
    await checkout.stopReturnServer();
  }
});

test('cancel url keeps an open Checkout session payable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-stripe-'));
  let paymentStatus = 'unpaid';
  let sessionStatus = 'open';
  const checkout = new stripe.StripeTestCheckout({
    env: env({ CUBBIT_STRIPE_TEST: '1', STRIPE_SECRET_KEY: 'sk_test_abc' }),
    orderFile: path.join(dir, 'orders.json'),
    now: () => LAUNCH,
    fetchImpl: async (url, options) => {
      if (options && options.method === 'POST') return { ok: true, status: 200, json: async () => sessionBody() };
      assert.match(url, /\/v1\/checkout\/sessions\/cs_test_123$/);
      return {
        ok: true,
        status: 200,
        json: async () => sessionBody({ payment_status: paymentStatus, status: sessionStatus, payment_intent: paymentStatus === 'paid' ? 'pi_after_cancel' : null }),
      };
    },
  });
  const started = await checkout.startReturnServer({ port: 0 });
  assert.equal(started.ok, true);
  try {
    const created = await checkout.createCheckout({ planId: 'base' });
    const cancelPage = await fetch(`${started.base}/stripe-test/cancel?order_id=${encodeURIComponent(created.order.id)}`);
    const html = await cancelPage.text();
    assert.equal(cancelPage.status, 200);
    assert.match(html, /仍可支付/);
    assert.equal(checkout.getOrder(created.order.id).status, 'pending');

    paymentStatus = 'paid';
    sessionStatus = 'complete';
    const synced = await checkout.syncOrder(created.order.id);
    assert.equal(synced.ok, true);
    assert.equal(synced.order.status, 'paid');
    assert.equal(synced.order.stripePaymentIntentId, 'pi_after_cancel');
    assert.equal(checkout.getOrder(created.order.id).licenseKey, undefined);

    checkout.getOrder(created.order.id).status = 'cancelled';
    checkout.ledger.upsert(checkout.getOrder(created.order.id));
    paymentStatus = 'unpaid';
    sessionStatus = 'open';
    const reopened = await checkout.syncOrder(created.order.id);
    assert.equal(reopened.order.status, 'pending');
    paymentStatus = 'paid';
    sessionStatus = 'complete';
    const paidAgain = await checkout.syncOrder(created.order.id);
    assert.equal(paidAgain.order.status, 'paid');
  } finally {
    await checkout.stopReturnServer();
  }
});

test('quotes attached for the store use the same USD amount the session will charge', () => {
  const plans = stripe.decorateSellables([{ id: 'base', price: 6800, name: '完整版' }], env({
    CUBBIT_STRIPE_TEST: '1',
    STRIPE_SECRET_KEY: 'sk_test_abc',
  }), LAUNCH);
  assert.equal(plans[0].price, 6800);
  assert.equal(plans[0].stripeTestQuote.amount, 1999);
  assert.equal(plans[0].stripeTestQuote.amountText, '$19.99');
  const untouched = stripe.decorateSellables([{ id: 'base', price: 6800 }], env({}), LAUNCH);
  assert.equal(untouched[0].stripeTestQuote, undefined);
});
