#!/usr/bin/env node
'use strict';

/**
 * 创建或核对一张 Stripe 测试订单。
 * 没有 sk_test_ 密钥时只打印还缺什么，不会假装支付成功。
 *
 *   CUBBIT_STRIPE_TEST=1 STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-test-checkout.js
 *   CUBBIT_STRIPE_TEST=1 STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-test-checkout.js --plan base
 *   CUBBIT_STRIPE_TEST=1 STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-test-checkout.js --sync ord_test_...
 */

const stripe = require('../src/main/stripe-test');

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return '';
  return value;
}

function samples() {
  const ids = ['base', 'dlc_season_winter', 'dlc_custom_char', 'ai_month', 'ai_year', 'couple_year', 'lite_couple'];
  return ids.map((id) => {
    const resolved = stripe.resolveSku(id, Date.now());
    if (!resolved.ok) return { id, error: resolved.code };
    return {
      id,
      amountText: stripe.formatMinor(resolved.sku.amount, resolved.sku.currency),
      mode: resolved.sku.mode,
      interval: resolved.sku.interval,
      priceSource: resolved.sku.priceSource,
    };
  });
}

async function main() {
  const orderFile = process.env.CUBBIT_STRIPE_ORDER_FILE || '';
  const checkout = new stripe.StripeTestCheckout(orderFile ? { orderFile } : {});
  const status = checkout.status();
  const wantsPlan = process.argv.includes('--plan');
  const syncId = arg('--sync');

  if (!wantsPlan && !syncId) {
    console.log(JSON.stringify({
      ready: status.enabled,
      productionCharging: false,
      code: status.code,
      message: status.message,
      priceNote: status.priceNote,
      orderFile: checkout.orderFile,
      samples: samples(),
      needed: status.enabled ? [] : [
        'CUBBIT_STRIPE_TEST=1',
        'STRIPE_SECRET_KEY=sk_test_...（不要使用 sk_live_）',
        '可选：STRIPE_PUBLISHABLE_KEY=pk_test_...，STRIPE_WEBHOOK_SECRET=whsec_...',
        'Stripe Dashboard 保持 Test mode，并在 Payment methods 里打开 Google Pay',
      ],
    }, null, 2));
    return;
  }

  if (!status.enabled) {
    console.error(status.message || 'Stripe 测试模式未开启。需要 CUBBIT_STRIPE_TEST=1 和 STRIPE_SECRET_KEY=sk_test_...');
    process.exit(status.blockCheckout ? 1 : 2);
  }

  if (syncId) {
    const synced = await checkout.syncOrder(syncId);
    console.log(JSON.stringify(synced, null, 2));
    process.exit(synced.ok && synced.order && synced.order.status === 'paid' ? 0 : 1);
  }

  const started = await checkout.startReturnServer();
  if (!started.ok) {
    console.error(started.message || '本地回跳服务没有启动');
    process.exit(1);
  }
  const created = await checkout.createCheckout({
    planId: arg('--plan') || 'base',
    email: arg('--email') || undefined,
  });
  if (!created.ok) {
    console.error(created.message || created.code);
    await checkout.stopReturnServer();
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    paid: false,
    order: created.order,
    returnBase: started.base,
    orderFile: checkout.orderFile,
    next: '在浏览器打开 order.payUrl。用 Stripe 测试卡（4242 4242 4242 4242）或 Google Pay 测试卡组完成付款。不会扣真钱。付完后本进程的回跳页会入账，也可以另开终端执行 --sync <订单号>。',
  }, null, 2));

  if (!process.argv.includes('--wait')) {
    console.log('回跳服务保持运行，方便 Stripe 跳回本机入账。完成后按 Ctrl+C。');
    await new Promise(() => {});
  }

  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const synced = await checkout.syncOrder(created.order.id);
    if (synced.ok && synced.order && synced.order.status === 'paid') {
      console.log(JSON.stringify(synced.order, null, 2));
      await checkout.stopReturnServer();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  console.error('等待超时，订单仍未支付。没有把它记成已支付。');
  await checkout.stopReturnServer();
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
