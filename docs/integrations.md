# Private configuration and operations

Private credentials and deployment environment values live in the root `.env` file (ignored by Git, permissions 0600). `.env.example` is the shareable template. The native launcher loads it; Docker Compose forwards server-only keys to the Go service. Restart the services after changing values. Never use `NEXT_PUBLIC_` for service credentials.

| Setting | Purpose |
|---|---|
| `NESHAN_API_KEY` | Neshan service key for reverse geocoding. The supplied key is stored only in local `.env`. |
| `SMS_ENABLED` | Keep `false` while testing. Set `true` only after configuring and validating Kavenegar. |
| `KAVENEGAR_API_KEY` | Kavenegar account API key. |
| `KAVENEGAR_SENDER` | Approved sender for order-stage messages. |
| `KAVENEGAR_VERIFY_TEMPLATE` | Approved verification template containing `%token`. |
| `SUPPORT_URL` | Full `https://wa.me/989…` or `https://t.me/…` support link. An owner-panel support link overrides this default. |
| `POST_TRACKING_URL_TEMPLATE` | Defaults to `https://pishkhan24.com/posttracking/?barcode={tracking}`. The code is URL-encoded. |
| `APP_ORIGIN` | Exact customer-facing origin, also used in order SMS links. |
| `SITE_URL` | Site metadata URL. |

Neshan reverse geocoding uses [the v5 API](https://platform.neshan.org/docs/api/search-category/reverse-geocoding/). The map uses Leaflet/OpenStreetMap tiles; the private service key never reaches the browser. Selecting a point fills the editable street, city and province. Customers must check the address and add apartment details and postal code. Manual entry remains available when location permission or the provider fails. Saved latitude/longitude stay with the address and order snapshot.

Kavenegar uses [verification lookup and SMS send](https://kavenegar.com/rest.html). With real SMS enabled, no OTP is returned in browser responses. Order transitions save both their history and an SMS job in the same transaction. The worker processes jobs every 30 seconds, checks provider acceptance, and retries failures with exponential backoff up to eight attempts. The analytics screen shows pending, sent-to-provider, and failed counts. Provider acceptance is not handset delivery confirmation. Network timeouts can cause duplicate messages on retry; delivery is at least once. Use a clean deployment database before enabling SMS so development orders do not produce real notifications.

Pishkhan24's public tracking-page implementation was inspected on 2026-09-26: its initialization reads `route.query.barcode` into `TrackingCode`. Both shipment SMS and customer order views use this supported prefill parameter. The copy-code action provides a fallback if the provider changes its interface.

## Package catalog

Each product defines its own packages: amount, unit (`g`, `kg`, `ml`, `l`), price in toman in the staff form, and maximum count (default 5). Every package also records its upright length, width and height in centimetres and its total shipping weight in grams, including its container and individual protective wrapping. Contents and gross shipping weight are separate; volume never implies a liquid weight. Prices are stored as integer rials. A separate package ID is used in carts and order snapshots, so two sizes remain two lines. Cart updates and checkout validate the package limit and manual product availability.

Existing products without package definitions receive one compatibility package based on that product's previous minimum weight and proportional price. Staff should replace these with the intended commercial package sizes and prices. Migration 002 preserves existing orders and open carts: exact valid multiples become package counts; incompatible old cart lines require the customer to select a new package.

Owner price controls apply either a visible percentage discount or a signed flat adjustment to every package's base price. They can target one product or all products. Changes update published and draft prices in one transaction; invalid prices reject the whole operation. Flat adjustments have no discount label. Percentage discounts replace, rather than stack with, previous percentages.

The owner can set the free-shipping subtotal threshold in **ارسال**. Zero disables it; a discounted merchandise subtotal at or above a positive threshold gets free shipping. The destination must still have an applicable shipping rule.

## Tracking and analytics

Customers are sent to `/account/orders/{id}` after successful payment. The four stages are paid, packaged, shipped and received. Staff can advance one step at a time; shipping requires a numeric tracking code. Tracking numbers and events are retained in the customer account. Each completed stage creates one notification job; repeated stage requests cannot duplicate jobs.

The owner-only `/omnisire/analytics` workspace includes daily sales, product clicks and purchases, package quantities, price history, customers, categories, and searches. The sidebar contains report navigation. Date controls default to the past seven Tehran calendar days and accept up to 366 days. Line charts compare up to 12 selected entities, with a keyboard-accessible daily scrubber and accessible data table. Pie charts use all matching results, independent of table pagination and line selections; smaller shares are grouped as “Other”. Package breakdowns follow selected products. Prices carry the last recorded effective package price forward; unknown earlier history stays empty. Excel exports include every filtered report row. Visits and searches start accumulating after installation and are deduplicated per session for 30 minutes; no historical click data is fabricated.

Recommendations rank available products by matching category first, then popularity (paid package counts weighted by 10 plus recorded product visits), with a deterministic name tie-breaker. There is no manual recommendation picker.

Articles and long product sections use Streamdown for incremental Markdown rendering, including lists, tables, links, emphasis and code. Raw HTML is skipped, unsafe URL schemes are filtered, and inline Markdown images are disabled; use the existing uploaded article/product images.

Real payment integration and production activation remain outside this change. The existing development-only startup gate remains in place.

## Refreshing the local test catalog

The explicit development command `go run ./cmd/server refresh-demo-catalog` (run from `backend` with `APP_ENV=development` and `DATABASE_URL` set) archives the original seeded and browser-test products and creates six package-based samples: salt, oil, turmeric, mint, discounted sesame, and unavailable cinnamon. Historical orders are retained. It does not run automatically at startup. Repeating it restores sample prices and manual availability. Old sample cart lines are removed.

With `SMS_ENABLED=false`, open `/account`, request a verification code using a valid Iranian mobile number, and enter the temporary code displayed in the form under **پیامک آزمایشی · کد ورود**. The code expires in five minutes; requesting another has a one-minute cooldown. No SMS is sent. Use the same number to return to the same customer account.

## Omnisire rollout

Restart the Go service to apply migration 004 before serving the updated frontend. Back up a production database before any migration. Existing staff retain their roles and receive stable referral codes. Missing names, mobile numbers or bank cards are flagged for owner completion; a card is required before recording payouts. Historical orders/logs remain intact and receive no retroactive referral commissions. Price history starts with an explicitly marked migration baseline; click measurement starts when this release is installed.

Owners sign in with the existing password/authenticator flow and land in `/omnisire`. The owner-only workspace switch opens ordinary staff tools. Managers, editors, operators and salespersons land in their first permitted section. Create members, record the displayed authenticator setup secret, and configure role restrictions in **همکاران**. Password/authenticator resets revoke existing sessions. Archival is permanent through the member interface and preserves records.

Payments entered in Omnisire are records of external transfers, with amount, reference and date; they do not call a bank. Correct a payment using its reversal action, and record externally refunded net merchandise through the attributed purchase. Salaries and a full returns workflow are not included. The simulated payment provider remains unchanged.

For isolated acceptance testing, set `TEST_DATABASE_URL` to a disposable PostgreSQL database and run backend tests with `-race`. Set `OMNISIRE_SCALE_TEST=1` to include the 1,000-product, 1,000-member, 100,000-order and 1,000,000-event fixture. Browser tests accept `BASE_URL` and `CHROMIUM_PATH`. `BOMISH_DIST_DIR` can isolate Next build output from an existing local development server.

## Shipping provider integration and simulation

Shipping has two independent controls: store configuration (`legacy` or `calculated`) and the server-only development flag `SHIPPING_SIMULATED=true`. The default remains legacy, with both providers disabled. Simulation requires `APP_ENV=development`; production startup restrictions and simulated payment behavior are unchanged. Do not enable real SMS for acceptance tests.

The simulator persists courier records in `simulated_shipments`; it survives restarts and never contacts a carrier. Authorized staff can advance simulated statuses through `POST /staff/orders/{id}/shipments/simulate` only when simulation is enabled. Quotations, invoice snapshots, readiness, booking leases and customer/staff screens otherwise use the same orchestration as a future verified provider. Simulation checks are labelled and never certify a live account.

Live adapters are deliberately **not wired for activation**. `SNAPP_API_KEY` and `TAPIN_API_KEY` are server-only presence indicators, not activation switches. The Tapin adapter implements the documented shop-specific `/api/v2/public/order/post/check-price/` flow and uses `entries.total_price` once, without adding its components again. Fake HTTP fixtures cover multi-parcel aggregation and exact decimal monetary conversion. Merchant onboarding must verify its authorization header, shop/service/locality/box mappings, monetary unit, request product prices and inclusive total field before wiring it to the application. Public external calculator tariffs are never substituted.

The Snapp HTTP transport supports separate quote/create/lookup/cancel capabilities, bounded responses, credential-safe redirects and no automatic mutation retries. It requires a `SnappContract` implementation for the merchant's **verified current B2B schema**. That live wire-contract binding remains an activation prerequisite: the published documentation URLs were inaccessible during this implementation, and no old API route or booking/authentication schema was invented. Fixture contracts exercise the transport; the application uses only `Disabled` or the durable simulator. Complete and test this binding in the authorized provider environment before installing a live adapter.

Operations must enter a measured Tehran origin with confirmed pin and verified active boxes in the staff Shipping section. Technical operators enter locality and postal carton mappings in `config/shipping.json`. Locality IDs are stable internal IDs; provider codes are separate. The catalog begins empty rather than fabricating nationwide mappings. The technical operator enters and verifies the merchant's supported cities in the file. Unmapped old addresses retain their text and prompt for city confirmation. Nominal box templates are optional inactive supplier examples and contain no invented inside dimensions, weight, padding, capacity or provider mappings.

Provider checks are read-only. No settings save, checkout quote, payment or packing completion creates a courier. Staff explicitly requests the courier after review. Postal label purchase and booking remain outside the application; record a distinct barcode and nullable actual cost for each parcel. Zero cost means zero; blank means unknown.

Provider check results are retained in the audit history and shown only for the same saved configuration revision and simulation/live environment. Changing settings or leaving simulation requires a fresh check. Driver name/phone, when supplied by the provider, are exposed only in the authorized staff delivery view. An uncertain refresh retains the last confirmed milestone internally so a later stale response cannot regress pickup.

For recovery: refresh an uncertain shipment first. Do not delete attempts or recycle references. A manager/owner with orders permission may record a reason and confirm that the provider has no active booking through the resolution action. Resolve or cancel before correcting packing or changing methods. A method change needs a fresh alternative quote, a reason and customer consent obtained outside the application. The app does not automatically contact the customer or issue refunds for these exceptions. The customer invoice remains unchanged.

## Simplified staff shipping workflow

The product wizard has five steps. In **بسته‌ها**, each stable package card combines selling details and shipping measurements. Measurement help and copying are secondary controls. Saving complete measurements after visiting this step explicitly confirms them on the server; unrelated edits do not certify old estimates. Partial drafts remain allowed, calculated-mode publication requires complete confirmed measurements, and legacy mode retains preparation warnings. Changing contents does not rescale dimensions. Old `step=shipping` links open the merged package step.

In **ارسال**, complete the pickup address, select stocked cartons, then review delivery policy and the free-shipping threshold. Readiness separates merchant preparation from integration setup. Provider settings, city and postal carton mappings, calculation mode and legacy tariffs are managed in `config/shipping.json`; quotation testing remains a separate expandable section. The interface retains read-only integration readiness and directs staff to the technical operator when setup is incomplete. Saves are explicit and retain concurrent-edit protection. Existing stores remain in their saved mode; calculated activation in this release requires simulation.

The routing rule is **Tehran city: Snapp; all other cities: post**, including other cities in Tehran province. Internal locality identity is independent of postal provider mappings. Missing postal mappings do not block an eligible Snapp quote. Postal orders select among boxes with eligible postal mappings and limits. When Snapp is unavailable or over capacity, checkout shows the postal reason and price. Acceptance refers to that exact unexpired quote ID, bound to the customer, cart, address, discount and configuration revision; it neither silently requotes nor enables future automatic fallback.

The versioned Cartonbank catalog is embedded in `backend/internal/app/shipping_box_catalog.json`. Each listing has its own source URL and nominal exterior dimensions; these are supplier specifications, not a universal national size standard. For example, [the size-one supplier listing](https://cartonbank.com/product/کارتن-پستی-سایز-یک/) distinguishes usable interior dimensions and manufacturing tolerance. Selecting a catalog entry copies its reference into the store configuration. Staff must supply and confirm actual usable interior dimensions, empty weight, capacity and shared padding before activating it. Postal mappings are separate technical configuration. Incomplete entries are excluded from packing. Existing custom boxes and historical snapshots are preserved; catalog updates never rewrite them. Development fixtures have a separate simulation label and cannot be activated outside simulation.

Packing remains a bounded suggested arrangement: products stay upright, may rotate on their base, and can use supported stacking across multiple parcels within weight and interior-clearance limits. Product measurements already include individual wrapping; box padding is applied separately. Staff confirms the actual packing before explicitly dispatching. Postal booking stays manual. Customer charges remain immutable, duplicate-booking protection remains in place, and later method changes require customer consent. No live carrier activation or label purchases are included.


## Shipping configuration file

Edit **`config/shipping.json`** for shipping integration setup. This file is initialized from the local store's existing settings. `config/shipping.example.json` shows the available fields with providers disabled; its tariff and locality are illustrative, so do not replace an existing store's complete configuration with the example.

The native launcher (`scripts/dev-local.sh`) loads this file at API startup. Docker Compose mounts the `config` directory read-only and uses the same file. Restart the API after editing (`docker compose restart api` for Compose; stop and rerun the native launcher for local development). Running the native launcher while it is already running does not restart it. Direct backend launches must set `SHIPPING_CONFIG_FILE` to the absolute filename.

Keep API keys in the root `.env`: `SNAPP_API_KEY`, `TAPIN_API_KEY`, and the development-only `SHIPPING_SIMULATED` switch. Never put keys in the JSON or frontend code. Compose now forwards these variables to the API. Environment changes in Compose require `docker compose up -d --force-recreate api`.

| Field | What to enter |
| --- | --- |
| `mode` | `legacy` for existing weight-band tariffs; `calculated` only after completing activation prerequisites. |
| `localities` | Supported cities. Each entry has stable internal `id` and `provinceId`, Persian `province` and `city`, and provider-issued `tapinProvince` / `tapinCity`. Set `verified` only after confirming the postal mappings. The array replaces the full saved city list; keep IDs used by saved addresses. |
| `snapp`, `tapin` | Provider account and service settings described below. Omitted properties retain their saved values. |
| `postalBoxSizes` | Provider-issued postal size ID for each saved carton, keyed by its stable box `id`. Export the current configuration after adding cartons to get these keys. Omitted keys keep their mappings; an empty string clears a mapping. Unknown box IDs are rejected. |
| `packagingGrams` | Packaging weight added by legacy pricing, in grams (0–10,000). |
| `rules` | Full replacement list of legacy tariff bands: `province`, `maxGrams`, and `feeRials`. Amounts are **rials**, so 65,000 toman is `650000`. Do not repeat the same province/weight boundary. IDs are generated automatically. |

Provider objects accept `enabled`, `service` (provider service ID), `shopId` (Tapin merchant/shop ID), `currency` (`rial` or `toman`, matching the provider response), and `verified` (confirmation of the configured provider contract). Snapp also needs `cityId` and an `area` polygon of `[latitude, longitude]` pairs. Capacity fields are `maxGrams`, `maxVolumeCm3`, `maxParcels`, and `maxSize` (`lengthMm`, `widthMm`, `heightMm` in **millimetres**). Obtain actual IDs, coverage and limits from your provider; the example deliberately does not invent them. These verification flags never enable the currently disabled live adapters.

Omitted top-level fields retain saved settings; `{}` preserves the entire current setup. Arrays replace their saved lists; `[]` explicitly clears a list. `postalBoxSizes` merges individual keys; `{}` keeps existing mappings. Unknown fields, malformed JSON and invalid configuration cause startup/import to fail without changing saved settings. Successful changes are applied atomically, recorded in configuration history and the audit log, and increment the revision so existing quotes must be refreshed. Reapplying unchanged values does not increment the revision.

Pickup address, stocked cartons, free-shipping threshold and support link remain managed through **ارسال**. File imports never overwrite physical carton details or other merchant settings; they only update the postal mapping within each carton. Interface saves cannot overwrite technical settings, even when a browser submits old or modified technical fields.

To export an existing deployment's configuration before editing, run from `backend/` with the same `DATABASE_URL` and `APP_ENV=development` as that API:

```bash
go run ./cmd/server export-shipping-config > ../config/shipping.json
```

Export does not apply the configured file. For Compose, use `docker compose exec -T api /app/server export-shipping-config > config/shipping.json` from the repository root. The output contains no API keys or merchant address.

To apply the file immediately without restarting an already-running API:

```bash
# From backend/, with the target API's database and simulation environment:
SHIPPING_CONFIG_FILE="$PWD/../config/shipping.json" go run ./cmd/server apply-shipping-config
```

Compose equivalent: `docker compose exec -T api /app/server apply-shipping-config`. For a new calculated setup, first import provider settings and city mappings with `mode: "legacy"`, complete pickup address/cartons/product measurements in the interface, then change the file to `mode: "calculated"` and apply it again. Activation retains all existing readiness checks and requires the development simulator in this release.

The opt-in shipping browser acceptance suite also needs `DATABASE_URL` pointing to its disposable API database; it uses this CLI to set up integrations. It must never target a real store database.


### Postal carton mappings

The provider's box-size code is technical setup and is no longer an editable carton field. First save the physical carton in **ارسال**, then export the configuration. The `postalBoxSizes` object lists each saved carton ID, including unmapped cartons with an empty value. To identify a carton, match that ID to the `id` and `name` in the authenticated `GET /api/v1/staff/shipping` response (`boxes`). Enter the provider-issued code for that ID and apply the file:

```json
{
  "postalBoxSizes": {
    "YOUR_SAVED_BOX_ID": "PROVIDER_SIZE_ID"
  }
}
```

Do not use a carton name as the key; names can change. Renaming a carton or editing its measurements retains its provider mapping. New ordinary cartons start unmapped and are excluded from postal packing until configured. The explicit development-only simulated carton gets the fixed `sim-box` mapping on creation; it never establishes a live provider mapping. Clearing its mapping in the file is respected on later interface saves. Historical shipment snapshots are unchanged.

### Other technical variables

The remaining integration and runtime controls already live in `.env`, not the staff interface. `.env.example` includes the full set: carrier/map/SMS credentials and switches, SMS sender/template, postal tracking URL template, default support URL, public site URL/indexing, app origin, database connection, listen address, uploads path, demo seeding, frontend API address and optional build directory. These remain environment settings because they include secrets or are needed before the database/configuration importer starts. The native launcher and Compose supply their own database/service paths; commented direct-run examples should only be enabled when launching services manually.

Physical dimensions, carton weights/capacities, free-shipping threshold, customer-facing support link, order tracking numbers, prices and discounts remain everyday business controls in the interface.
