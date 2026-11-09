# 方块仔 · Stripe 测试结账（Google Pay）

商店和付费墙可以在 **Stripe 测试模式** 下打开托管结账页。Google Pay 是 Stripe 的支付方式，收款方是 Stripe，不是单独接的 Google Pay / Google Wallet 商户。

正式扣款保持关闭：没有 `pk_live_` / `sk_live_`，`checkoutReady` 仍是 `false`。未设置下面的测试开关时，不会向 Stripe 下单。

## 环境变量

不要把真实密钥写进仓库、不要提交 `.env`。只在本机终端里导出：

| 变量 | 作用 |
| --- | --- |
| `CUBBIT_STRIPE_TEST` | 必须是 `1` 才启用测试结账 |
| `STRIPE_SECRET_KEY` | 测试开关打开时必须是 `sk_test_...`。此时若是 `sk_live_`，这次测试结账会拒绝，不会拿 live 密钥去下单。开关关闭时，残留的 live 密钥会被忽略，商店仍走原来的许可服务 |
| `STRIPE_PUBLISHABLE_KEY` | 可选，`pk_test_...`。托管 Checkout 不需要把它打进客户端 |
| `STRIPE_WEBHOOK_SECRET` | 可选，`whsec_...`。不配置时忽略未签名 webhook，订单仍靠向 Stripe 查询会话来入账 |
| `CUBBIT_STRIPE_RETURN_PORT` | 可选，本机回跳端口，默认 `8788`，只监听 `127.0.0.1` |
| `CUBBIT_STRIPE_ORDER_FILE` | 可选，测试订单账本路径。应用默认写在 Electron userData 的 `stripe-test-orders.json`；脚本默认写在 `~/.cubbit/stripe-test-orders.json` |

两个条件缺一不可：只放了 `sk_test_` 但没有 `CUBBIT_STRIPE_TEST=1`，不会改走 Stripe。

## 在 Stripe 测试模式打开 Google Pay

1. 打开 [Stripe Dashboard](https://dashboard.stripe.com)，右上角确认是 **Test mode**（不要切到 Live）。
2. 进入 **Settings → Payment methods**（支付方式）。
3. 在 Wallets 里找到 **Google Pay**。它默认是关的，把它打开。卡片支付保持打开。
4. 这里用的是 Stripe 托管页 `checkout.stripe.com`，按钮不画在方块仔自己的域名上，所以 **不要** 为本仓库登记 Google merchant id，也不需要把 `pingguye.cn` 注册成 Google Pay 域名。
5. 结账请求 **不传** `payment_method_types`，这样 Dashboard 里打开的支付方式（含 Google Pay）才会出现。

Google Pay 按钮还依赖浏览器：

- 用 Chrome（不要用无痕窗口）。
- 登录一个 Google 账号。Stripe 文档说明：钱包里至少要有一张卡，按钮才渲染得出来。这张卡只是为了让按钮出现。
- 真正付款请用 [Google Pay 测试卡组](https://docs.stripe.com/google-pay) 或 Stripe 测试卡 `4242 4242 4242 4242`，有效期用任意未来日期，CVC 任意三位。
- 保持 Dashboard 在 Test mode。测试模式创建的是测试 PaymentIntent / Checkout Session，不会按正式模式扣款。
- 印度 IP 下，Google Pay 在正式模式不展示；测试沙箱是否出现还和 Stripe 账户所在地有关。看不到按钮时，先用测试卡完成同一张 Checkout，仍会得到一张真实的测试订单。

## 价格

没有改 `catalog.js`、`offer-config.js`、`lite-config.js` 里的标价。

Google Pay 不会把人民币当作展示币种，所以测试扣款用的是 **已经写在目录里的美元价**：

- 商店方案和 DLC：`catalog.js` 的 `priceUsd`（完整版 `base` 为 **$19.99**，一次性；冬季皮肤包 `dlc_season_winter` 为 **$4.99**）。人民币 `price` 仍显示在方案卡片上。
- 测试结账合计栏会改成这笔美元金额，避免界面确认的数字和 Stripe 实收不一致。
- 付费墙情侣包：`lite-config.js` 当前展示价（首发期内 **$14.99**，之后 **$19.99**），一次性。
- 月付 / 年付方案若出现在商店里，会创建 Stripe 测试订阅，而不是一次性付款。
- `offer-config.js` 的地区价没有拿来覆盖上面这些数字，也没有改它。

测试路径不接受优惠码，避免把生产环境的券算进来。

## 下一张测试订单

当前环境如果没有 `sk_test_`，下面的命令只会告诉你还缺什么，**不会**把订单标成已支付。

```bash
npm run stripe:test
```

准备好测试密钥以后：

```bash
export CUBBIT_STRIPE_TEST=1
export STRIPE_SECRET_KEY=sk_test_替换成你的测试密钥
# 可选
# export STRIPE_PUBLISHABLE_KEY=pk_test_...
# export STRIPE_WEBHOOK_SECRET=whsec_...

# 先看状态和将要收取的测试价
npm run stripe:test

# 为商店里的「完整版」创建一张一次性 Checkout（最简单的已有付费 SKU）
node scripts/stripe-test-checkout.js --plan base

# 或者从应用里走同一条路径
npm start
```

应用内：打开商店，确认顶部出现「Stripe 测试模式」提示，选中完整版，点购买。系统浏览器会打开 `https://checkout.stripe.com/...`。付完后商店轮询 Stripe，把本地订单改成 `paid`，并显示 Checkout Session 和 PaymentIntent。付费墙在同一个开关下会为情侣包（`lite_couple`）打开同一类测试页。

回跳地址只在本机 `127.0.0.1`。付款成功页会写明这是测试入账。订单 JSON 里没有密钥，也 **没有** 激活码。测试模式不会去调用 `https://pingguye.cn/cubbit/api` 写正式授权。

核对已有订单：

```bash
node scripts/stripe-test-checkout.js --sync ord_test_订单号
```

可选 webhook（不配也能入账，因为客户端会向 Stripe 查询会话）：

```bash
stripe listen --forward-to http://127.0.0.1:8788/stripe-test/webhook
```

把 CLI 打印的 `whsec_...` 放到 `STRIPE_WEBHOOK_SECRET`。签名不对或 `livemode=true` 的事件不会入账。

## 为什么用托管页

这是 Electron 桌面应用。Google Pay 在应用内的 Payment Request 里经常因为浏览器环境直接不出现。Stripe 托管 Checkout 是真正的 HTTPS 页面，由 Stripe 渲染 Google Pay，比在 `BrowserWindow` 里自绘按钮可靠。主进程只用系统浏览器打开这个链接。

## 正式上线之前还要做的

- 本机还没有测试密钥时，先按上面的方式导出 `sk_test_`，实际付一笔测试款，并在 Dashboard 的 Test mode 里看到 Checkout Session 和 PaymentIntent。
- 确认 Google Pay 在测试结账页上出现；若暂时不出现，用测试卡付同一张 Checkout，证明订单链路，再回头查 Dashboard 开关和浏览器条件。
- 决定正式价用哪一套（`catalog.price` 人民币、`catalog.priceUsd`、`offer-config` 地区价目前并不相同），再单独开正式模式。
- 正式激活码仍要许可服务用私钥签发。这次只记录测试订单，不解锁 Pro。
- 明确说可以上线之后，才允许 `sk_live_` / `pk_live_`，并另做正式 webhook 与授权写入。在那之前，只要测试开关是开的，代码就会拒绝 live 密钥。开关关闭时不会用残留的 live 密钥挡住原来的结账。
