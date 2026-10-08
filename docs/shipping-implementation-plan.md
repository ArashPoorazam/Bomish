# Bomish shipping implementation handoff

Implement package measurements, calculated delivery pricing, and staff fulfillment controls in the existing Bomish application. This document replaces the earlier conversational plan and supplies the context needed by an agent with no conversation history. It is an implementation specification; the shipping feature has not yet been built.

Repository: `/home/daedalus/Projects/Bomish`. Baseline inspected on 2026-10-07: Go backend, PostgreSQL, Next.js 16 and React 19 frontend, Persian RTL interface, integer rial storage and toman display. Preserve the existing payment simulator and production startup restrictions. Do not book real couriers, purchase labels, send real SMS, or activate production as part of development verification.

## Agreed behavior and implementation defaults

The user has selected these business policies:

- Dispatch all orders from one Tehran location.
- Prefer Snapp for eligible Tehran deliveries. Explicitly offer postal delivery when Snapp cannot serve the order; use postal delivery outside the eligible Tehran area.
- Staff requests the courier after the paid order has been packed. Payment and packing alone must never request a courier.
- Collect shipping with the merchandise payment. If Snapp's fare changes before dispatch, Bomish absorbs the difference. Show that difference to staff before booking.
- Treat every sellable package as a rectangular cuboid. Record its outer dimensions and gross weight; do not require bottle, jar or other shape classification.
- Keep packages upright, allowing a 90-degree rotation on the base. Use conservative packing estimates validated against real orders.
- Add a dedicated, well-designed measurement step to product creation and editing, and update staff shipping and order interfaces throughout.

Use these defaults to keep the first release bounded:

- Retain Neshan for address assistance. It is not a dependency required by Snapp.
- Implement Tapin as the postal quote provider. Use the shop-specific quote flow matching the merchant's dispatch account; the public calculator may support diagnostics but must not silently substitute a different tariff.
- Start with one configured Snapp bike service after its capacity and account eligibility are verified. Orders exceeding its configured limits fall back to post. Automatic selection of cars/vans, scheduled delivery windows and multi-destination courier runs are outside this release.
- Postal booking and label purchasing remain manual. Add calculated postal quotations, parcel-level tracking and actual-cost entry, not automatic postage purchases.
- No customer-facing handling markup or separate box charge in this release. Include carrier-mandated charges in the quote; Bomish absorbs packaging materials and differences between the accepted customer charge and actual cost.
- Keep existing order payment states. Model provider delivery progress separately rather than adding courier states to the payment/order status enum.
- Introduce an explicit store-wide `legacy`/`calculated` shipping mode. Start in `legacy`; no automatic fallback to fixed prices once `calculated` is selected.

## Repository facts and implementation entry points

Read the current repository and applicable AGENTS.md instructions before editing. Frontend instructions require reading the relevant installed Next.js documentation. Respect concurrent work: at the inspection baseline, `backend/migrations/001_initial.sql` already had an unrelated local modification. Do not overwrite it or edit old migrations for this feature; create new numbered migrations.

Use the following existing areas rather than creating a separate dashboard:

| Area | Entry points relative to the repository |
|---|---|
| Product wizard | `frontend/src/components/staff/product-editor.tsx`, `product-form.ts`, `product-packages.tsx` |
| Staff shipping settings | `frontend/src/components/staff/operations.tsx`, mounted by `dashboard.tsx` |
| Staff fulfillment | `frontend/src/components/staff/order-manager.tsx`, `order-detail.tsx`, `order-stages.tsx` |
| Checkout and addresses | `frontend/src/components/checkout.tsx`, `address-map.tsx`, `address-book.tsx`, `account-addresses.tsx` |
| Customer tracking | `frontend/src/components/customer-order.tsx`, `order-tracking.tsx`, `order-progress.tsx`, `frontend/src/lib/order-stages.ts` |
| Backend | `backend/internal/app/checkout.go`, `cart.go`, `staff_operations.go`, `order_packing.go`, `services.go`, `permissions.go`, `app.go` |
| Domain and contract | `backend/internal/domain/model.go`, `api/openapi.json`, generated `frontend/src/lib/api-types.ts` |
| Existing guidance | `docs/architecture.md`, `docs/integrations.md`, `docs/launch.md`, `docs/verification.md` |

Current behavior that must be addressed:

- The product wizard has five steps and hard-coded step indices. It needs six steps, updated issue routing, submit behavior, next/back controls and review summaries.
- `Package.Weight()` uses merchandise amount for g/kg variants and `shippingGrams` for ml/l variants. It is also used in cart data and other displays. Do not globally change its meaning and accidentally alter merchandise labels, filters, quantities or reports. Add a distinct validated gross-shipping-weight accessor and audit consumers.
- Shipping quotes currently accept only province and look up predefined weight bands after adding one global packaging weight. Carrier pricing needs a complete destination and parcel plan.
- Checkout holds database locks while recalculating its current local quote. Never insert external network calls inside that locked transaction.
- Staff currently advances orders through `paid → packing → shipped → received`. The packing checklist is per order line and means all quantities in that line are packed. The new readiness gate must be enforced server-side, not just shown in the UI.
- Staff shipping requires a numeric 10–30 digit tracking code. Customer views and SMS build postal links unconditionally. Snapp needs provider-specific identifiers and tracking behavior.
- The map uses Leaflet/OpenStreetMap; Neshan only reverse-geocodes a pin. Saved addresses and order snapshots already support latitude/longitude.

Split packing, quote policy, provider clients and fulfillment orchestration into focused modules. Avoid expanding the existing large order-detail component or staff_operations.go into a provider-specific conditional tree.

## Product measurement interface

The six wizard steps must be:

1. «اطلاعات اصلی»
2. «تصاویر»
3. «بسته‌ها و قیمت»
4. «بسته‌بندی و ارسال»
5. «اطلاعات تکمیلی»
6. «بررسی و انتشار»

In the new step, render one card per sellable variant using its existing stable package ID. Show the variant label, such as «بسته ۵۰۰ گرمی», and a completion badge. Do not make staff create the same variant twice.

Each card contains «طول», «عرض», «ارتفاع» in centimetres and «وزن بسته آماده ارسال» in grams. Show units next to inputs, never only in placeholders. Add a simple labelled box diagram, with height visibly vertical. Explain: «ابعاد و وزن را با ظرف، درپوش و محافظ دور همان محصول اندازه بگیرید؛ کارتن ارسال جداگانه محاسبه می‌شود.» A brief bottle example can explain bounding dimensions without introducing a shape field.

Support decimal centimetres to one decimal place, integer grams, Persian/Arabic digit normalization and keyboard entry. Canonical storage uses integer millimetres. Reject nonfinite, negative, zero, overflow and excessive values on the server. Use technical bounds of 1–3000 mm per dimension and 1–1,000,000 g per package; these are input bounds, not permission to ship such a parcel. Carrier capacity checks are separate. For g/kg variants, gross weight cannot be lower than the declared net weight.

Provide an explicit «کپی اندازه‌ها از بسته دیگر» selector; copying is a local draft operation and does not link variants. Changing sale amount/unit must not silently rescale physical dimensions. Removing a variant removes its draft measurements. Keep pricing permissions unchanged.

Blank measurement fields are allowed in a draft. Partially entered values must remain editable and invalid values must be identified beside their fields. Before publication in calculated mode, all variants must have complete valid shipping measurements. Review shows dimensions, gross weight and a link back to fix incomplete cards. While legacy mode is active, missing measurements produce a preparation warning rather than retroactively blocking existing publication behavior.

Add a catalog badge/filter «اطلاعات ارسال ناقص» based on the published variant data, plus a link directly to the shipping step. Show missing fields, not just a generic invalid-product error. Existing published products are not automatically unpublished.

## Staff shipping settings

Replace the flat settings form within the existing «ارسال» section with four clearly labelled sections. Preserve navigation and unsaved-change protection. Use explicit Save buttons, a saved/unsaved indicator and version checking to prevent two staff members silently overwriting one another. Do not autosave provider activation.

### Dispatch location

Collect sender name, phone, address, province/city selections, postal code and a confirmed pickup map pin. Keep provider-specific locality identifiers behind the human-readable selectors. Store one origin revision and snapshot it into quotes and shipments so later edits never change historical orders.

### Boxes and packing

List available boxes with name, usable inside dimensions, exterior dimensions, empty weight, allowed gross weight, protective inset, filler weight, postal size identifier, active state and verification state. Use centimetres/grams in the form and integer millimetres/grams in storage.

Protective inset reduces usable dimensions once; product-level wrapping is already included in variant measurements. Filler weight is added once per parcel. The old global packaging weight is used only in legacy mode, never added on top of calculated parcels. Capacity must exceed the box-plus-filler weight, inside dimensions cannot exceed exterior dimensions, and provider size mappings must match verified exterior sizes. Historical references survive box edits and archival.

Seed optional inactive templates for nominal sizes 1–9: 15×10×10, 20×15×10, 20×20×15, 30×20×20, 35×25×20, 45×25×20, 40×30×25, 45×40×30 and 55×45×35 cm. Label these supplier examples requiring measurement. Do not invent inside dimensions, empty weights, padding, capacity or provider IDs. No template becomes active until staff completes and verifies it.

### Providers and shipping policy

Show separate Snapp and Tapin cards: disabled, not configured, verification required, ready or temporarily unavailable; display last successful check and a human-readable error. Credentials remain server-only environment values. Show presence and test status, never secret values in forms, responses or logs. Tests are read-only authentication/quote checks and must not create bookings.

Configure the Snapp service category, supported Tehran service area and verified load limits; postal shop/service identifiers; provider enabled flags; and the overall shipping mode. Version all quote-affecting settings. Activation checks origin, providers, active boxes, capacity settings, currency mapping and measurement completeness of currently purchasable published variants. Show a checklist linking to each incomplete item.

Retain free-shipping threshold and support URL. Put old province/weight rules under «تعرفه‌های قبلی» and show them as inactive in calculated mode. A provider outage must never silently reactivate them. An explicit rollback to legacy is audited and invalidates unconsumed quotes, while paid orders retain their original method and price.

### Preview and diagnostics

Add a staff-only quote preview: choose variants and quantities, destination and map pin, then display estimated parcels, per-parcel contents/weights, chosen provider, price breakdown and fallback reason. It must say «آزمایش محاسبه؛ بدون ثبت ارسال». Allow real account quote tests only after configuration; label simulated results distinctly. This screen is also the acceptance tool for comparing estimates with actual packing.

## Packing calculation

Implement a pure, deterministic packing module operating on validated snapshots. It must return parcel assignments, placement coordinates/orientations, exterior size, actual gross weight and a structured failure reason. Never use summed volume as proof that items fit.

For the first release, use a bounded upright cuboid-placement heuristic: sort units by descending base area, then height, then stable package ID and unit index; try both base rotations. Generate candidate placements from box boundaries and placed-item faces; choose the lowest valid z, then y, then x. Reject overlap, out-of-bounds placement, unsupported stacking and weight overflow. Above-floor items must have their full base supported by coplanar items below. This estimates geometric fit, not crush resistance; individually packed products must be suitable for upright stacking, and staff must confirm the real packing.

Try each active box for the remaining items. If a box fits everything, choose the smallest exterior volume, then empty weight, then stable box ID. Otherwise choose the candidate fitting the greatest summed product volume, tie-breaking by smallest exterior volume and box ID, remove those units and repeat. This intentionally does not promise a globally optimal packing or cheapest possible carrier bill. Do not change the selected boxes merely to conceal pricing differences.

Protect checkout with a deterministic work budget: at most 500 product units, 20 parcels and 100,000 placement attempts per calculation. Stop with an explicit manual-arrangement outcome if these limits are exceeded; do not change existing purchase limits or claim that a timed-out search proves physical impossibility. Reject a request when even one item cannot fit any box or exceeds all weight limits. Staff diagnostics explain the specific issue; checkout gives a concise support route without charging an invented shipping amount.

Store the packing algorithm version with the plan. Test all geometry and weight invariants independently. Validate representative real orders before activation.

## Address and checkout experience

Use dependent province/city selectors backed by a local catalog of stable locality IDs and versioned provider mappings. Do not infer carrier locality IDs from arbitrary spelling or Neshan text. Preserve readable labels and old free-text addresses. If an old address cannot be mapped unambiguously, ask the customer to confirm its city when reused; never silently select a different city.

Keep Neshan reverse geocoding to fill editable address text. Coordinates must be saved even if Neshan is unavailable. Fix map marker synchronization when a saved address changes. A changed city or street invalidates prior pin confirmation until reconfirmed. Protect against stale reverse-geocoding replies overwriting later user edits.

Snapp requires a confirmed pickup and delivery pin. Tehran province alone is not eligibility: require the configured city and verified service-area check, then the provider's own validation. A successful quote does not guarantee driver availability. If the customer cannot provide a pin, explain that Snapp is unavailable and offer post if its address requirements are complete.

Checkout shows an address stage followed by a delivery card with provider, service description, parcel count where useful, shipping charge and total. Display realistic service copy without inventing guaranteed arrival times. Fetch automatically after required inputs are complete, with a short debounce and protection against out-of-order responses. Show a loading state, retry action and specific unavailable message. Block payment while the current quote is absent, invalid or expired; never show 0 as a placeholder shipping price.

Prefer Snapp for eligible Tehran orders; request a postal alternative if Snapp is ineligible or its quote is unavailable. Show the reason and require the customer to accept the postal option before checkout. Outside the eligible area, select post normally. A deliberately accepted postal fallback should not silently switch back to Snapp during background refresh. No checkout request may create a carrier shipment.

Keep the existing financial policy: merchandise subtotal already includes product discounts; the free-shipping threshold is evaluated against that subtotal before order coupon deduction. Coupons reduce merchandise only. Even with free shipping, establish serviceability and retain the carrier quote; store the customer shipping charge as zero and the merchant cost separately. Store integer rials and display toman; verify each provider's monetary units. Round a non-whole-toman customer shipping amount upward once at the order total of all parcels, retaining the original carrier amount.

Use persisted, opaque, customer-bound quotes. Local validity is five minutes or a shorter provider expiry. Bind to normalized destination and confirmed coordinates, origin/config/packing revisions, cart quantities, current package measurements/prices, selected method and discount inputs. A quote response supplies its ID, expiry, totals, service, parcel summary and fallback/acceptance state.

Checkout sends `shippingQuoteId`, the selected method, destination, `expectedTotalRials` and the existing idempotency key. Validate quote ownership, all bindings and expiry under the existing checkout concurrency controls. First return an already-created order for an idempotent retry even if its original quote has since expired. Consume a valid quote atomically with order creation; never trust a client-provided shipping price. If anything changed, return a structured conflict requiring a new quote and review. Do not call a carrier while holding database locks. Once an order is created, retain its agreed total through the existing payment reservation flow; quote expiry does not mutate that pending order.

## Staff order list and detail experience

### Order list

Retain existing search, pagination and status filters. Add a delivery-provider filter and delivery-attention filter for ready to dispatch, waiting for courier, booking uncertain, failed delivery and missing information. Apply filtering and counts on the backend across all pages.

Each row shows a provider badge, order stage, separate delivery status, parcel count and a concise next-action label. Distinguish «بسته محصول» from «کارتن ارسال». Show failure/attention labels with text and an icon, not color alone. Preserve search/filter/page and return focus when closing detail. New delivery events participate in the existing unread notification system; do not add an unrelated polling or alert mechanism.

### Order detail and packing

Keep order totals, recipient details, line checklist and history. Add a delivery panel with chosen provider, destination/pickup map previews, parcel cards and the shipment timeline. Read historical measurements from the order snapshot, not the current product catalog.

Parcel cards show box name/size, contents by variant and quantity, estimated gross weight and a simple per-layer packing view with numbered items and a text equivalent. They are an aid, labelled «چیدمان پیشنهادی», not a promise of physical fit. Offer print-friendly packing information without requiring a PDF subsystem.

Allow staff to correct parcel assignments, choose another configured box and record measured gross weight before dispatch. Require all ordered units to appear exactly once, valid box limits, a reason for changes and an explicit physical-packing confirmation. For a manual layout, validate individual item fit and weight, record that arrangement was staff-confirmed, and do not pretend it was verified by the automatic heuristic. Requote after changes. Never alter the customer's paid amount.

Readiness requires confirmed payment, every order line checked, every parcel physically confirmed, a valid destination and an eligible delivery configuration. Enforce this for both postal dispatch and Snapp booking. Edits to contents or boxes clear readiness and any dispatch quote. Do not allow packing edits once a booking is active or uncertain; resolve/cancel the booking first.

Keep the existing customer `packing` milestone meaning: the packaging-completed message is sent only when readiness is confirmed. Checklist work may occur while the order is `paid`; completing readiness advances to `packing` atomically. Reopening packing clears readiness but must not send duplicate milestone notifications or erase history.

### Snapp dispatch

The next-action panel leads staff through these steps:

1. «بررسی هزینه پیک» fetches a fresh dispatch quote and shows pickup, recipient, service and parcel summary.
2. Display «دریافت‌شده از مشتری», «هزینه فعلی پیک» and «اختلاف هزینه برای بومیش». Include a clear statement that the customer will not be charged again.
3. «درخواست پیک» is the explicit booking action. A dispatch review is valid for 60 seconds or a shorter documented provider expiry. If stale or the inputs changed, refresh and require review again. Do not claim this locally timed review locks Snapp's price.
4. Show pending submission, awaiting courier, accepted, picked up and delivered states with the appropriate next action. Persist the request before network submission so a page refresh does not lose it.

Disable duplicate submissions in both UI and backend. On an uncertain network result, show «نتیجه درخواست در حال بررسی است» and a status-refresh action, not an unrestricted Retry booking button. Clearly distinguish a booking failure from a successfully saved booking whose UI refresh failed. Show wallet/authentication/service errors as actionable Persian messages without secrets or raw stack traces.

Display driver/contact information only when the provider supplies it and staff needs it. Offer cancellation only when supported for the current state; use an in-app confirmation explaining known fees or uncertainty. Do not automatically rebook a cancelled order. A deliberate replacement uses a new attempt identifier after the previous result is resolved.

### Postal dispatch and exceptions

Postal parcels have separate tracking-code and actual-cost fields. Retain postal tracking validation for those fields; do not apply it to Snapp identifiers. Require all parcel barcodes before marking the order shipped in this release. Reusing a barcode across parcels is rejected. Actual cost may remain unknown until staff records it; zero means genuinely zero, not unknown. Staff confirms final delivery once all parcels arrive.

Before payment, postal fallback is accepted in checkout. After payment, a delivery-method change requires a manager/owner, a reason and a recorded confirmation that the customer agreed; it cannot happen automatically. Never switch while a Snapp booking is active or uncertain. Requote and show the cost difference; Bomish absorbs it. Record consent obtained outside the app without automatically messaging the customer. If the customer declines or delivery remains impossible, hold the order for staff resolution using the existing support/refund process. Automated refunds are outside this release.

## Backend persistence and API boundaries

Extend package JSON with `lengthMm`, `widthMm`, `heightMm`; use `shippingGrams` consistently as gross weight for calculated shipping, with a distinct completion/verification signal for legacy data. Preserve existing net amount/unit and old order `grams` semantics. Existing liquid weight values may be prefilled but are not evidence that all shipping measurements were verified.

Add versioned shipping configuration/boxes, persisted expiring shipping quotes, order shipping snapshots, parcels and their item allocations, shipment attempts and delivery events. These records must retain provider/service IDs, immutable origin/destination/measurement snapshots, quoted cost, customer shipping charge, nullable actual cost, method-change reasons, external reference, status, timestamps, configuration/algorithm version and audit actor where relevant. Quote and dispatch attempt ownership/uniqueness must be enforced by database constraints. Keep external statuses and redacted diagnostic information separate from customer-facing status.

Use three backend boundaries: a pure packing module, provider quote/booking clients, and an application service handling routing, financial policy and durable operations. Postal clients need quote capability only. Snapp supports quoting, creating, looking up and conditionally cancelling a booking. Expose capability differences instead of assuming all providers support every operation.

Extend the existing versioned API and OpenAPI contract as follows; paths below are relative to `/api/v1`:

| Interface | Required behavior |
|---|---|
| Existing product read/write | Round-trip dimensions, gross weight and readiness without bypassing publication/price permissions |
| `GET /shipping/localities` | Searchable province/city selections and stable IDs; no provider secrets |
| `POST /checkout/quote` | Full destination, coupon and method/fallback choice; authoritative persisted quote or typed unavailable outcome |
| `POST /checkout` | Add shipping quote reference and selected method; keep expected total and idempotency |
| `GET/PUT /staff/shipping` | Versioned origin, boxes, policies and nonsecret provider settings |
| `POST /staff/shipping/providers/{provider}/check` | Read-only connectivity/configuration validation |
| `POST /staff/shipping/preview` | Staff quote/packing preview; never book |
| Existing staff order list/detail | Delivery filters, parcels, costs, readiness, allowed actions and delivery events |
| `PUT /staff/orders/{id}/parcels` | Version-checked parcel corrections and measured weights |
| `POST /staff/orders/{id}/ready` | Atomically validate checklist/parcels and confirm readiness |
| `POST /staff/orders/{id}/dispatch-quote` | Fresh quote bound to current order, parcels and method |
| `POST /staff/orders/{id}/shipments` | Explicit durable Snapp booking, requiring dispatch quote and idempotency key |
| `POST /staff/orders/{id}/shipments/refresh` | Reconcile provider state without creating another booking |
| `POST /staff/orders/{id}/shipments/{shipmentId}/cancel` | Explicit supported cancellation; idempotent and audited |
| `POST /staff/orders/{id}/delivery-method` | Restricted, consent-recorded change before active dispatch |
| `PATCH /staff/orders/{id}/parcels/{parcelId}` | Postal tracking and actual-cost updates under state/version checks |
| `POST /webhooks/snapp` | Provider-authenticated event receipt and durable processing |
| Existing customer order/tracking | Safe delivery summary and provider-specific tracking without staff cost/diagnostic fields |

Use structured error codes for missing measurements, unsupported destination, packing limit, missing pin, stale quote, stale version, provider unavailable and booking uncertain. Show localized explanations in the UI. Return allowed actions from the backend so authorization and state requirements are not independently reinvented in each component.

## Booking safety and delivery synchronization

Use a durable shipment-attempt record and transactional outbox/job before invoking Snapp. Do not keep a database transaction open during an external request. Run workers with leases so concurrent processes cannot submit the same active attempt. Enforce at most one active or unresolved courier booking per order.

Use a stable external reference for each attempt. The Snapp FAQ says reusing a reference after a cancelled order can create a new booking, so a reference alone is not sufficient protection. Following timeouts or crashes, query the existing attempt's external reference and reconcile before any creation retry. If lookup cannot settle the outcome, require staff resolution. Explicit replacement after confirmed cancellation uses a new attempt reference. A worker may retry safe reads, but must not blindly retry side-effecting creation or cancellation.

Validate callback authentication using the current provider-supported mechanism. Never trust an unsigned status merely because it contains an order ID. If webhook authentication cannot be securely verified, use callbacks only as prompts for authenticated order lookup and rely on the lookup for state changes. Bound payloads, deduplicate events, validate provider references and retain the original event time. Persist the event before acknowledging it. Process duplicate, late and out-of-order events without regressing delivered orders or emitting duplicate SMS.

Keep delivery states separate: not requested, submitting, unknown, awaiting courier, accepted, picked up, delivered, cancelled, failed and returning. Courier acceptance does not mean shipped. Map confirmed pickup to `shipped`, and confirmed final delivery to `received`. Driver allocation cancellation is not order cancellation. Failed delivery/return flags staff attention without changing payment validity or automatically marking received. A delivered event received before a pickup event must still converge correctly and produce coherent, nonduplicated history.

Reconcile active/unknown shipments using a background worker at a default 60-second interval, respecting published provider limits and backing off on failures to a maximum 15-minute interval. Stop ordinary polling at terminal delivery states. UI refresh reads our backend; browsers never poll Snapp directly. Poll staff detail only while visible, preserve edits and last good data, and expose freshness plus manual refresh.

Keep actual booking/settlement charges distinct from quotation amounts. If the booking or a later provider update reports a different cost, update the merchant cost and audit it without changing the customer invoice. Delivery-cost variance is visible in order detail; it must not enter merchandise revenue or referral-commission calculations. A new analytics dashboard is outside scope.

Update shipment SMS and customer tracking links to branch by provider. Use only validated provider tracking URLs or Bomish's own order page. Never send a Snapp ID to the postal tracking site, expose merchant costs, or mark an order delivered merely because staff requested a courier.

## Permissions and interaction quality

Reuse current section permissions and restrictions. Product-authorized staff can edit measurements; existing price controls remain unchanged. Shipping-authorized owners/managers configure origin, boxes and provider settings. Orders-authorized operators/managers/owners pack, review fares, request couriers and record postal tracking. Delivery-method changes and final manual resolution of uncertain bookings require manager/owner role plus orders permission. All mutations are enforced in Go and audited, not merely hidden in React.

Use the existing cream/green design, Vazirmatn typography, spacing and component vocabulary. Persian labels, RTL layout, LTR numeric/coordinate fields and isolated mixed-direction identifiers must remain readable. Mobile layouts stack cards and controls without wide editable tables or page-level horizontal scrolling.

Every added screen must define empty, loading, ready, validation-error, provider-error, stale-data and saved states where relevant. Associate field errors with labels, move focus to the first invalid field, announce async results politely, provide keyboard access and restore focus after dialogs. Avoid replacing a form with a skeleton after edits begin. Preserve dirty changes on failed saves and refreshes. Disable only the affected action; a transient refresh failure must not permanently disable unrelated valid controls. Use explicit confirmations for cancellation/method changes, not for ordinary measurement edits.

## Migration and compatibility

Create additive migrations; preserve old orders, addresses, carts, prices, tracking, payment attempts and user changes. Old orders with no new shipping snapshot remain `legacy_postal` for display and existing fulfillment, with no fabricated dimensions or carrier cost. Do not rewrite previous shipping charges.

Keep draft/published product separation intact. Measurement readiness for checkout comes from published data. Provide the staff missing-measurements list so the merchant can complete and publish variants before activation. In calculated mode an incomplete cart cannot obtain a shipping quote; do not silently use the old bands or remove items from the customer's cart.

Preserve net product labels and weight-related catalog/report behavior; use separate gross parcel totals for shipping. Backfill only unambiguous locality mappings; unresolved old addresses prompt for confirmation on reuse. New shipping settings must be versioned and initialized disabled/legacy. Store disabled provider configuration without requiring secret credentials to develop or test the UI.

## Provider verification and launch prerequisites

These external facts are activation prerequisites, not invitations to invent defaults or stop all implementation:

- The merchant supplies the actual Tehran pickup address/pin, contact and postal code.
- Measure actual boxes, protective margins/filler weights and gross package weights. Confirm load limits and stacking suitability with real packing trials.
- Obtain Snapp business credentials, enabled service category, coverage, capacity, rate limits, monetary units, cancellation rules and supported callback authentication.
- Obtain Tapin shop credentials/service identifiers, authoritative locality/box mappings, parcel limits and confirmation that quoted tariffs match actual dispatch. Confirm which returned field includes all required charges without double-counting totals and their components.
- Configure HTTPS callbacks, background workers, server-only secrets and an authorized provider test environment. Do not expose `.env` or secrets in screenshots, fixtures or logs.

Known documentation evidence:

- [Snapp B2B reference](https://docs.snapp-box.com/docs/API/b-2-b-experience-api) and [pricing endpoint](https://docs.snapp-box.com/docs/API/get-order-pricing): the published pricing schema documents `POST /v1/pricing`, service category, terminals with coordinates, package weight in grams, volume in cubic centimetres, and fare fields `finalCustomerFare`/`totalFare`. It does not document a guaranteed price lock in that response. Confirm the monetary unit and complete booking/authentication contracts rather than inferring them from examples.
- [Snapp integration guide](https://docs.snapp-box.com/docs/integration-guide) and [FAQ](https://docs.snapp-box.com/): staging and production environments, business onboarding, webhook events and reference-ID caveats. The site served its home-page shell for some documentation URLs during inspection; verify the actual operation schema, not only the page title. Do not mix unrelated older SDK/API versions.
- [Tapin shop quote](https://api.tapin.ir/api/v2/public/doc/?fn=order_check_price) and [standalone quote](https://api.tapin.ir/api/v2/public/doc/?fn=external_order_check_price): shop quotations and standalone quotations differ. Use the verified account flow for checkout.
- [Neshan reverse geocoding](https://platform.neshan.org/docs/api/search-category/reverse-geocoding/): current application usage is address assistance; it does not price or dispatch deliveries.
- [Supplier box dimensions](https://karakianpack.com/postal-carton/): nominal templates only. Do not hard-code previously discussed surcharge percentages as a live shipping tariff.

Keep provider adapters testable with fixtures and fake HTTP servers so the entire application workflow can be completed before credentials arrive. Never fabricate successful live verification. In the final implementation report, distinguish completed code/UI/test work from any remaining live-activation prerequisites.

## Implementation sequence and acceptance tests

1. Add schemas/migrations, distinct gross-weight semantics, measurement readiness and the six-step product UI. Update OpenAPI and generated frontend types.
2. Add origin/localities/boxes/settings UI, deterministic packing module and staff preview. Verify real-layout invariants with fixtures.
3. Implement provider clients and server quote persistence/routing. Connect checkout and address confirmation with clear fallback and expiry handling.
4. Add immutable order snapshots/parcels, readiness controls, delivery-aware staff list/detail and manual postal tracking.
5. Implement durable Snapp booking/reconciliation/cancellation, safe callback handling, customer progress, notification updates and permissions.
6. Run automated and browser acceptance checks, document operation/rollout, then deliver the complete feature with live providers disabled until prerequisites are verified.

Required automated coverage:

- Measurement draft/save/reload/publication, multiple variants, copy behavior, Persian digits, decimal cm conversion, invalid values, g/kg gross weight and legacy compatibility.
- Single/mixed items, exact fits, base rotations, forbidden tipping, padding, support, overlap, overflow, deterministic layouts, quantity allocation, multiple boxes, weight ceilings and bounded-search failures.
- Snapp coverage versus Tehran province, missing/stale pin, postal locality mapping, oversized bike load, unavailable provider, explicit fallback acceptance and unavailable/free-shipping combinations.
- Rial/toman conversion, multi-parcel aggregation, provider component totals, rounding, free-shipping threshold before coupon, coupon limits and unchanged merchandise/referral accounting.
- Quote ownership/expiry/configuration changes, cart/destination changes during requests, forged fees, stale totals, concurrent checkout and idempotent retries after expiry.
- Unpaid/incomplete orders cannot dispatch; readiness and version checks; concurrent staff edits; parcel corrections invalidate dispatch review; customer totals remain immutable.
- Duplicate clicks, network failure before/after creation, crash recovery, unknown booking resolution, reference reuse after cancellation and unauthorized action attempts.
- Authentication/deduplication of webhooks, out-of-order events, allocation cancellation, delivery failure/return, missed callbacks, reconciliation and one-time milestone notifications.
- Provider-specific tracking URLs/SMS, multiple postal barcodes, nullable costs, legacy order display and customer data isolation.

Required browser acceptance journeys:

- Editor creates a two-variant product, enters measurements with keyboard/Persian digits, saves an incomplete draft, resolves errors and publishes; mobile layout and focus behavior work.
- Manager completes shipping setup, sees accurate readiness blockers, previews an order and activates calculated mode only when valid. Operator cannot change settings.
- Customer checks out to Tehran with a confirmed pin; simulated Snapp quote failure offers an explicitly accepted postal alternative. Address/cart changes invalidate old prices and stale replies cannot win.
- Operator opens a paid order, verifies parcel contents, completes readiness, reviews a fare difference and requests exactly one simulated courier. Reloading during an uncertain result cannot create another booking.
- Simulated pickup/delivery updates staff and customer timelines; postal orders retain manual barcode flow, and historical orders continue to render.
- Review screenshots at narrow mobile and desktop widths for product measurement, shipping settings, staff list/detail, booking review/error and customer delivery selection. Test keyboard access and visible error recovery, not only happy-path rendering.

Run the repository's relevant backend tests, `go vet`, database integration tests with a disposable test database, frontend typecheck, formatting check, production build and targeted Playwright suites. Use the existing scripts and installed runtime versions. Regenerate OpenAPI types and sqlc output only where their sources changed. Do not run browser fixtures against a live merchant database or modify real products for acceptance testing. Extend tests with meaningful behavior, especially geometry, billing and repeat-safe booking.

Update architecture, integrations, launch and verification documentation with environment keys, provider setup, locality/box maintenance, callback verification, recovery procedures and rollback behavior. Completion means the staff and customer workflows are implemented together, tests pass, UI states have been inspected, and every unverified external prerequisite is explicitly reported. No part of this handoff authorizes production activation or a real shipment.
