# E-commerce Backend API

REST API for the e-commerce website described in the HLD: storefront (browse, search, filter, cart, checkout, order history) and admin panel (catalog management, CSV import, order management, dashboard).

**Stack:** Node.js · NestJS 11 · TypeScript · Prisma 6 · PostgreSQL (Neon) · JWT · argon2 · class-validator · Swagger · Jest

The backend is a **modular monolith** (HLD §3). The Next.js frontend is a separate project.

---

## 1. Requirements

- Node.js **≥ 20** (developed on 22) and npm
- A PostgreSQL database: **Neon** in production; Neon or local PostgreSQL for development
- For e2e tests: a **separate, disposable** PostgreSQL database (a Neon branch, or `docker compose up -d`)

## 2. Installation

```bash
npm install
cp .env.example .env      # then edit .env (see below)
```

## 3. Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Runtime connection string. On Neon, use the **pooled** string (`...-pooler...`) with `?sslmode=require`. |
| `DIRECT_URL` | ✅ | — | Direct (non-pooled) connection used by Prisma Migrate. On Neon: the same string **without** `-pooler`. Without a pooler, set it equal to `DATABASE_URL`. |
| `JWT_SECRET` | ✅ | — | At least 16 characters; long and random in production (e.g. `openssl rand -base64 48`). The app refuses to start with `change-me` in production. |
| `JWT_EXPIRES_IN` | | `7d` | Token lifetime (`15m`, `12h`, `7d`, …). |
| `FRONTEND_URL` | | `http://localhost:3000` | CORS allow-list; separate several origins with commas. |
| `PORT` | | `3001` | HTTP port. |
| `APP_URL` | | `http://localhost:$PORT` | Public base URL of the API, used to build uploaded-image URLs. |
| `NODE_ENV` | | `development` | `development` / `production` / `test`. |
| `TRUST_PROXY` | | `1` | Number of reverse-proxy hops to trust for client IPs. |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | | `60000` / `120` | Global rate limit: requests per window (ms) per IP. |
| `AUTH_THROTTLE_LIMIT` | | `10` | Stricter limit for `/auth/*` per window. |
| `ADDRESS_API_BASE_URL` | | `https://provinces.open-api.vn/api/v2` | Vietnamese address provider. |
| `LOG_LEVEL` | | `info` | pino log level. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | seed only | — | Admin account created by `npm run seed`. |
| `SEED_CUSTOMER_PASSWORD` | seed only | — | Password of the two demo customers. |
| `TEST_DATABASE_URL` | e2e only | — | Disposable DB for `npm run test:e2e`. Can go in `.env.test`. **All its data is deleted.** |

All variables are validated at startup (`src/config/env.validation.ts`); the app fails fast on bad config. `.env` and `.env.*` are git-ignored; only `.env.example` is committed.

## 4. Prisma setup

```bash
npx prisma generate        # generates the typed client (also runs on migrate)
npx prisma validate        # checks prisma/schema.prisma
```

The schema lives in `prisma/schema.prisma`. Tables and columns are `snake_case` in PostgreSQL (`products.category_id`, …); ids are `BIGINT` and money is `DECIMAL(12,2)` as in the HLD.

## 5. Database migration

```bash
# development: apply migrations and create new ones after schema changes
npx prisma migrate dev

# production / CI / Neon: apply committed migrations only
npx prisma migrate deploy        # same as: npm run prisma:deploy
```

## 6. Database seed

```bash
npm run seed
```

Idempotent (safe to re-run). Creates: 1 admin (from `SEED_ADMIN_*`), 2 customers (`nguyen.van.an@example.com`, `tran.thi.binh@example.com`, password `SEED_CUSTOMER_PASSWORD`), 4 categories, 8 tags, 14 products with 3 images each, and 2 demo orders. The products cover every case: active PERCENT and FIXED discounts, expired and future discounts, an open-ended discount, IN_STOCK / OUT_OF_STOCK, and active / inactive products.

## 7. Development server

```bash
npm run start:dev           # watch mode, pretty logs
```

API: `http://localhost:3001` · Swagger UI: `http://localhost:3001/docs` · Health check: `GET /health`

## 8. Production build

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
NODE_ENV=production npm run start:prod
```

The API is stateless (JWT, cart in PostgreSQL), so it can be scaled horizontally behind a load balancer (HLD §8). In production, the stack trace is never included in error responses and Helmet's CSP is enabled.

## 9. Swagger documentation

- UI: **`/docs`** · raw OpenAPI JSON: **`/docs-json`** (usable with `openapi-typescript` to generate frontend types)
- Every endpoint documents its request DTO, query parameters, success envelope and error responses.
- Click **Authorize** and paste the `access_token` from `POST /auth/login`.

## 10. API overview

### Response format

```jsonc
// success
{ "success": true, "data": { ... } }
// paginated
{ "success": true, "data": [ ... ], "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 } }
// error
{ "success": false, "message": "Product not found", "code": "PRODUCT_NOT_FOUND" }
// validation error (400) also includes details
{ "success": false, "message": "...", "code": "VALIDATION_ERROR", "details": [{ "field": "address.wardCode", "errors": ["..."] }] }
```

Error codes are listed in `src/common/exceptions/error-codes.ts`.

**Naming:** request bodies use camelCase (as in the checkout request of the spec: `customerName`, `shippingMethod`, …); response bodies and query parameters use snake_case (`final_price`, `short_description`, `min_price`, …), except `pagination.totalPages` and `access_token`, which follow the spec. Ids are JSON numbers, and money values are JSON numbers in VND.

### Public

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` → `{ access_token, user }` (201) |
| POST | `/auth/login` | `{ email, password }` → `{ access_token, user }` |
| GET | `/products` | `?q=&category=&tag=&min_price=&max_price=&status=&on_sale=&sort=&page=&limit=` |
| GET | `/products/:code` | Detail by SKU; **404 if inactive** |
| GET | `/categories` | All categories (+ active product count) |
| GET | `/tags` | All tags |
| GET | `/scents` | Scent showcase (display only): visible scents, `?type=PERFUME|NATURAL` |
| GET | `/address/provinces` | Vietnamese provinces |
| GET | `/address/provinces/:provinceCode/wards` | Wards of a province |
| GET | `/health` | Liveness + DB check |

`GET /products` details:
- `q`: case-insensitive match on name, SKU/code, or tag name
- `category`: slug (`dien-thoai`) or numeric id
- `tag`: slug; comma-separated = any of (`tag=ban-chay,giam-gia`)
- `min_price` / `max_price`: applied to the **final (discounted)** price
- `status`: `IN_STOCK` | `OUT_OF_STOCK`
- `on_sale`: `true` = only products whose discount applies right now (final price < price); `false` = the others
- `sort`: `newest` (default) | `oldest` | `price_asc` | `price_desc` (final price) | `name_asc` | `name_desc`
- `page` (≥1), `limit` (1–100, default 20)

Each product includes `price`, `final_price`, `discount { type, value, start, end, is_active, amount }`, `category`, `tags`, `images`, `status`. The detail endpoint also returns `description`.

### Cart (guest or customer)

The cart works without login. With a Bearer token it is the user's cart; otherwise it is the guest cart named by the `X-Cart-Token` header. A guest's first `POST /cart/items` creates a guest cart and returns its token once as `guest_token` (only a SHA-256 hash is stored). After login, `POST /cart/merge` (Bearer + `X-Cart-Token`) moves the guest cart into the user's cart: quantities are added (max 99), hidden/out-of-stock lines are skipped, and the guest cart is deleted. Guest carts unused for 30 days are deleted. Checkout (`POST /orders`) still requires login.

### Customer (Bearer token)

| Method | Path | Description |
|---|---|---|
| GET / PUT | `/users/me` | Profile |
| GET | `/cart` | Items with `unit_price`, `final_price`, `subtotal`, `available`; `total`, `total_quantity` |
| POST | `/cart/merge` | Bearer + `X-Cart-Token`: merge the guest cart → `{ ...cart, merge: { merged, skipped } }` |
| POST | `/cart/items` | `{ productId, quantity? }`; adds to the quantity already in the cart |
| PUT | `/cart/items/:productId` | `{ quantity }` (absolute) |
| DELETE | `/cart/items/:productId` | Remove an item |
| DELETE | `/cart` | Empty the cart |
| POST | `/orders` | Checkout (see below) |
| GET | `/orders` | My orders, paginated, `?status=` |
| GET | `/orders/:id` | One of my orders (other users' orders → 404) |

Order items carry the purchase-time snapshot (`product_name`, `product_code`, `price`, `subtotal`) plus `image`: the product's *current* first image for display only (`null` once the product is deleted).

Checkout request:

```json
{
  "customerName": "Nguyễn Văn An",
  "phone": "0912345678",
  "shippingMethod": "DELIVERY",
  "desiredDate": "2026-10-20",
  "address": { "provinceCode": "1", "provinceName": "Thành phố Hà Nội", "wardCode": "4", "wardName": "Phường Ba Đình", "detail": "12 Kim Mã" }
}
```

For `PICKUP`, `address` may be omitted or `null`. For `DELIVERY`, every address field is required.

### Admin (Bearer token with role ADMIN)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/products` | All products incl. inactive; same filters + `is_active` |
| GET | `/admin/products/:id` | Detail |
| POST | `/admin/products` | Create (code, name, categoryId, price, discount*, status, isActive, tagIds, images) |
| PUT | `/admin/products/:id` | Partial update (omitted fields stay unchanged; `tagIds` / `images` replace) |
| PATCH | `/admin/products/:id/status` | `{ status }` |
| PATCH | `/admin/products/:id/visibility` | `{ isActive }` (hide / show) |
| DELETE | `/admin/products/:id` | Delete (order history keeps its snapshot) |
| DELETE | `/admin/products/:id/images/:imageId` | Remove one image URL from a product |
| POST | `/admin/products/import` | multipart `file` (CSV) → `{ total, success, failed, created, updated, errors[{row, message}] }` |
| POST / PUT / DELETE | `/admin/categories[/:id]` | Category CRUD (delete → 409 `CATEGORY_IN_USE` if products use it) |
| POST / PUT / DELETE | `/admin/tags[/:id]` | Tag CRUD |
| GET | `/admin/orders` | `?status=&customer=&id=&from=&to=&shipping_method=&page=&limit=` (plain `from`/`to` dates are Vietnam days, inclusive) |
| GET | `/admin/orders/export` | Same filters, no pagination → `.xlsx` (sheet 1: orders, sheet 2: product lines; max 10 000 orders) |
| GET | `/admin/orders/:id` | Detail incl. user and `allowed_transitions` |
| PUT | `/admin/orders/:id/status` | `{ status }` with transition validation |
| GET / POST / PUT / DELETE | `/admin/scents[/:id]` | Scent CRUD: `{ name, description, type: PERFUME|NATURAL, imageUrl?, isActive? }` (hide with `isActive: false`) |
| GET | `/admin/dashboard` | Product/order/revenue/customer stats, top products, recent orders |

`desiredDate` (desired receive date, `YYYY-MM-DD`) is required: from today to 180 days ahead in Vietnam time (`400 INVALID_DESIRED_DATE` otherwise). Orders return it as `desired_date` (`null` for older orders).

Order status workflow (handmade orders): `AWAITING_DEPOSIT` (Chờ cọc) → `DEPOSITED` (Đã cọc) → `IN_PRODUCTION` (Đang làm) → `COMPLETED` (Đã hoàn thành) → `SHIPPING` (Đang giao) → `DELIVERED` (Đã giao), plus `CANCELLED` (Huỷ). Admins can set any status at any time (skip ahead, go back to fix a mistake, cancel or reopen); every change is logged. Each admin order lists its `allowed_transitions` (every other status); setting the current status again returns `400 INVALID_STATUS_TRANSITION`. Dashboard revenue counts `DELIVERED` orders.

CSV format (UTF-8, header row required; `code,name,category,price` are mandatory, the other columns optional):

```csv
code,name,short_description,description,category,price,discount_type,discount_value,discount_start,discount_end,status,is_active,tags
IP15-128,iPhone 15 128GB,Ngắn,Dài,dien-thoai,22990000,PERCENT,10,2026-10-01,2026-10-31,IN_STOCK,true,ban-chay|chinh-hang
```

`category` and `tags` match by slug or name (case-insensitive). Separate several tags with `|`. Rows are upserted by `code`. A column that is absent from the header leaves that field unchanged on existing products.

### Business rules enforced (HLD §5)

1. `final_price` is computed on every read and never stored. PERCENT: `price × (1 − v/100)`; FIXED: `max(price − v, 0)`; it applies only while server time is within `[discount_start, discount_end]`.
2. Discount validation: PERCENT in 0–100, FIXED ≤ price, start ≤ end. It is re-checked against the *resulting* state on update (lowering the price below a FIXED discount is rejected).
3. OUT_OF_STOCK products are listed and viewable but cannot be added to the cart (409 `PRODUCT_OUT_OF_STOCK`).
4. Inactive products are hidden from listing, search and detail (404), but old orders still show them.
5. Checkout runs in **one PostgreSQL transaction**. It locks the cart (`FOR UPDATE`) and products (`FOR SHARE`), re-checks `is_active` and `status`, recalculates prices, creates the order and its items with the purchase-time price, then clears the cart. Any failure rolls everything back. Concurrent checkouts of the same cart create exactly one order.
6. Prices, subtotals, totals and status are **never** accepted from the client: unknown body fields are rejected with 400.
7. Customers can only access their own cart and orders.

## 11. Project structure

```
prisma/
  schema.prisma            data model (HLD §4)
  migrations/              SQL migrations (committed)
  seed.ts                  idempotent demo data
src/
  main.ts                  bootstrap
  app.setup.ts             helmet, CORS, validation, filters, interceptors, static uploads, Swagger
  app.module.ts            config, structured logging, rate limiting, global guards
  app.controller.ts        GET /health
  config/                  env validation
  prisma/                  PrismaService (global)
  common/
    cache/                 in-memory TTL cache (HLD §8)
    decorators/            @Public, @Roles, @CurrentUser
    dto/                   pagination
    exceptions/            AppException + error codes
    filters/               AllExceptionsFilter (single error format)
    guards/                RolesGuard (RBAC)
    interceptors/          response envelope, Cache-Control
    pipes/                 ParseIdPipe
    swagger/               response-envelope decorators
    utils/                 slugify, BigInt/Decimal serialisation
  auth/                    register/login, JwtStrategy, JwtAuthGuard, argon2 hashing
  users/                   /users/me
  products/                public + admin controllers, pricing logic, CSV import
  categories/  tags/       public list + admin CRUD
  cart/                    cart
  orders/                  checkout transaction, history, admin order management, status machine
  address/                 AddressService (isolated external provider) + endpoints
  admin/                   dashboard
test/                      e2e suites (supertest against a real PostgreSQL)
```

## 12. Testing

```bash
npm test                 # unit tests (no database needed)
npm run test:e2e         # e2e tests: needs TEST_DATABASE_URL (a disposable DB!)
npm run test:cov         # unit test coverage
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint (type-aware)
```

For the e2e tests, put `TEST_DATABASE_URL=...` in `.env.test` (git-ignored). The run applies migrations to that database and truncates it, and it refuses to run if `TEST_DATABASE_URL` equals `DATABASE_URL`. Use a Neon branch or the local Docker database (`docker compose up -d` creates `ecommerce_test`).

Coverage:
- **Unit** (61 tests): discount calculation and validation, rounding, status transitions, CSV row parsing, register/login/hashing, RBAC guard, add-to-cart rules (OUT_OF_STOCK, inactive, quantity cap), checkout (pickup/delivery address rules, server-side price snapshot, re-validation).
- **E2E** (82 tests): register, login, JWT (missing/tampered/foreign/expired/deleted-user tokens), admin authorization on every admin route, product search, filtering, sorting and pagination (incl. final-price range), inactive 404, cart operations, cannot add OUT_OF_STOCK, pickup checkout, delivery validation, transaction rollback (a failure injected after the order rows are written leaves no order and an intact cart), concurrent checkout, OrderItem keeps the historical price after price changes, product deletion keeps history, invalid status transitions, CSV import summary, image upload, dashboard.

---

## Design decisions

These choices were made where the HLD or spec left room. Each is the simplest production-ready option:

| Topic | Decision |
|---|---|
| **Ids** | `BIGINT` as in the HLD. They are serialised as JSON numbers (or strings if they ever exceed 2^53). |
| **Discount window** | A `NULL` `discount_start` / `discount_end` means open-ended on that side. Bounds are inclusive. A discount value of 0 counts as no discount. |
| **Money rounding** | Final prices and subtotals are rounded half-up to 2 decimals (`DECIMAL(12,2)`); totals use `DECIMAL(14,2)`. The same formula exists in SQL (for filtering/sorting) and in TypeScript (for responses), and the e2e tests check that they agree. |
| **Price filter/sort** | `min_price`, `max_price` and `price_*` sorting use the **final** price, so customers see consistent results. The list query is a parameterised SQL id query followed by one Prisma query with `include` (no N+1). |
| **Search** | PostgreSQL `ILIKE` over name/code/tag name with B-tree indexes as listed in the HLD. Meilisearch/Elasticsearch (HLD §3) can be added later behind `ProductsService.search` without API changes. |
| **Pagination** | Offset pagination (`page`/`limit`, max 100), as the frontend contract specifies. Keyset pagination (HLD §8) can be added for very large catalogs. |
| **Caching** | Public catalog reads use a 30 s in-memory TTL cache (HLD §8: 30–60 s), cleared on any admin catalog write, plus `Cache-Control` and ETag headers for the CDN and browsers. With several instances, other instances can be stale for up to the TTL, which the HLD accepts. |
| **Inactive vs missing** | Customers get the same 404 `PRODUCT_NOT_FOUND` for both, so hidden products cannot be probed. |
| **Cart with unavailable items** | `GET /cart` keeps them, flags them (`available: false`, `unavailable_reason`) and leaves them out of `total`. Checkout rejects with 409 `CART_HAS_UNAVAILABLE_ITEMS` and lists them in `details`; the cart is left untouched. |
| **Quantity** | 1–99 per product (there is no stock quantity in the HLD). Lowering the quantity of an unavailable item is allowed; raising it is not. |
| **Category deletion** | Refused (409 `CATEGORY_IN_USE`) while any product, active or not, uses the category. Deleting a tag only detaches it from products. |
| **Product deletion** | Hard delete. `order_items.product_id` becomes `NULL` (FK `ON DELETE SET NULL`), and the order keeps its name, code and price snapshot. Hiding (`isActive: false`) is the recommended way to retire products. |
| **Delivery address** | Stored on the order (no address book table in the HLD). Province/ward codes are verified against the address provider, and the canonical names are stored. If the provider is down, checkout is not blocked and the client's names are used. |
| **Address provider** | `provinces.open-api.vn` API v2, which reflects the 2-level (province → ward) structure in force since 07/2025. Nothing is stored in PostgreSQL; responses are cached for 24 h in memory. To switch provider, change only `src/address/address.service.ts`. |
| **Images** | Images are **URLs only** (`https://…`), hosted elsewhere (e.g. a CDN, Cloudinary, Google Drive public link). The API stores no files, so it needs no persistent disk and scales horizontally. |
| **CSV import** | File and header are validated up front. Each row is validated and reported, and each valid row is upserted in its own transaction, so one bad row never blocks the others or leaves a half-written product. Unknown categories or tags are errors (they are not auto-created). Limits: 5 MB, 5 000 rows. |
| **Auth** | argon2id (OWASP parameters), HS256 JWT. The user is re-loaded on each authenticated request, so deleted users and role changes apply immediately. Login has constant-time behaviour for unknown emails. Registration always creates `CUSTOMER`. Admins are created by the seed (or by promoting a user in the DB). |
| **Security** | Helmet, CORS allow-list, global rate limit plus a stricter `/auth` limit, global `ValidationPipe` (whitelist + forbid unknown fields), parameterised SQL only (Prisma), 1 MB JSON body limit, uploads checked by content. |
| **Logging** | Structured JSON logs via pino: request id (`X-Request-Id`), method, url, status, latency, auth failures, order creation, admin actions. `Authorization`, cookies, passwords and tokens are redacted. |
| **Admin module layout** | Admin endpoints for a domain live in that domain's module (e.g. `products/admin-products.controller.ts`) so business rules stay in one service. `admin/` holds cross-cutting features (dashboard). |
| **Neon** | Use the pooled URL for `DATABASE_URL` and the direct URL for `DIRECT_URL` (Prisma Migrate needs a direct connection). |
| **Prisma version** | Pinned to Prisma 6 (stable CommonJS client, `package.json#prisma` seed config). Moving to Prisma 7+ requires `prisma.config.ts` and a driver adapter. |
