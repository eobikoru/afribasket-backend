# AfriBasket API

US online grocery API for African food. Prices are integer cents in USD. Shipping addresses are US-only. The catalog is food plus household staples. Alcohol is rejected when an admin creates a product.

## Stack

Node.js 22, NestJS, PostgreSQL, Prisma, Redis, BullMQ, Zod, JWT access tokens with hashed rotating refresh tokens, Cloudinary, Resend, PayPal Orders v2, and Stripe Checkout.

## Local setup

1. Install Node.js 22 and Docker.
2. Copy the environment file and replace the secrets:

```bash
cp .env.example .env
```

3. Start Postgres and Redis:

```bash
docker compose up -d postgres redis
```

4. Install dependencies, apply migrations, and seed:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
```

The seed creates a super admin from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`, the category tree, shipping defaults, and about 25 grocery products. Image URLs are placeholders from `placehold.co`.

5. Run the API:

```bash
npm run start:dev
```

Health checks are `GET /health` and `GET /health/ready`. The public API is under `/api/v1`, admin routes under `/api/v1/admin`, and payment webhooks under `/api/v1/webhooks`.

OpenAPI is served at `/docs` when `DOCS_PASSWORD` is set (HTTP basic auth, user `DOCS_USER`). When the password is empty, `/docs` returns 404.

For a full stack in Docker, point `DATABASE_URL` at `postgres` and `REDIS_URL` at `redis://redis:6379`, then:

```bash
docker compose up --build
```

## Tests

```bash
npm test
npm run typecheck
```

Tests cover shipping zones, coupons, reservations and expiry, guest-order claim, PayPal and Stripe webhook signatures (including a paid amount that does not match the order), FEFO lot allocation, admin role guards, and auth rate limits. They do not require a running database.

## Payments

Checkout creates a pending order and a 15-minute stock reservation, then opens a PayPal order or a Stripe Checkout Session. The webhook is the source of truth. A paid amount that does not match `order.totalCents` leaves the order pending and flagged for review. It does not convert reserved stock into a sale.

Venmo is offered by the PayPal order (`payment_source.paypal` with unrestricted funding). There is no separate Venmo integration. Stripe Checkout is configured for card, Apple Pay, Google Pay, and Link.

Set `STRIPE_TAX_ENABLED=true` to calculate tax with Stripe Tax from the shipping address. When it is false, the API applies `TAX_FLAT_RATE_BPS` and labels the result estimated. Do not also enable Stripe automatic tax on the Checkout Session. The tax amount is already included in the session total.

### Stripe CLI

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

Copy the CLI signing secret into `STRIPE_WEBHOOK_SECRET`. The handler verifies `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`, and `payment_intent.payment_failed`.

### PayPal

In the PayPal developer dashboard, create a sandbox webhook for:

`https://<public-host>/api/v1/webhooks/paypal`

Subscribe to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, and `PAYMENT.CAPTURE.REFUNDED`. Put the webhook id in `PAYPAL_WEBHOOK_ID`. The API verifies the transmission signature against the PayPal certificate URL.

For local forwarding, expose port 3000 with a tunnel and register that HTTPS URL in the sandbox app.

## Jobs

With `JOBS_ENABLED=true` (the default outside tests), BullMQ runs three jobs:

- every 5 minutes, cancel unpaid orders whose reservation expired and release stock
- every 60 seconds, flush buffered blog view counts
- daily at 13:00 UTC, expire lots past their best-by date and email admins about low stock and lots inside 14 days

Set `JOBS_ENABLED=false` to run the API without workers.

## Admin

`SUPER_ADMIN` manages other admins. `ADMIN` manages catalog, inventory, orders, customers, coupons, banners, and settings. `BLOG_AUTHOR` manages blog content only. Sign in at `POST /api/v1/admin/auth/login`.
