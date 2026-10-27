# Frontend architecture

## Runtime and dependency policy

The application uses Next.js App Router, React, TypeScript and plain CSS. Commerce rules, authorization, prices and persistence remain in the Go API. Avoid adding a client state framework or UI framework for behavior that React, native browser controls and the existing components already provide.

Use stable npm releases, keep `react` and `react-dom` aligned, and commit both the manifest and lockfile. As verified on 2026-10-27: Next.js 16.4.3, React 19.3.1, TypeScript 7.0.2, Lucide 1.62.0, Playwright 1.64.1 and Prettier 3.9.10. Node 26.12.1 is recorded in `.node-version`, CI and the container. Your system runtime is managed separately; use that version when working locally. The isolated OpenAPI generator deliberately uses TypeScript 5.9.3: `openapi-typescript` 7.13.0 depends on the JavaScript compiler API removed from TypeScript 7. Do not merge its toolchain into the application dependencies until that compatibility changes.

## Rendering and route boundaries

- `src/app/layout.tsx` owns document metadata, the Persian font, global primitives and the skip link.
- `src/app/(storefront)/layout.tsx` owns the customer session, header, server-rendered footer, referral capture and support launcher. Its URLs are unchanged by the route group.
- `src/app/(workspace)/layout.tsx` owns the staff session and persistent workspace navigation. It does not import storefront chrome. Staff and owner navigation share this layout, preserving sidebar state.
- Each route group has an error boundary so page failures preserve its surrounding layout and session.
- Pages render on the server by default. Client boundaries contain interaction and browser state. Never wrap static page content in a client module just to access shared layout elements.
- `src/lib/server-api.ts` is protected by `server-only`. `src/lib/api.ts` owns browser session/CSRF handling and mutations. Do not put runtime backend configuration in browser modules.

`StoreProvider` owns session and cart data with a stable context value. `CartDrawer` owns modal focus, scroll locking and mutation feedback, and loads only when opened. The support launcher loads `SupportConversation` on first use and keeps it mounted when minimized so drafts survive navigation. Workspace sections use explicit dynamic imports; opening one section should not download every editor.

## Styles and content

`globals.css` contains common primitives and styles used across the store and workspaces. `workspace-base.css` contains the existing staff/editor rules extracted from the global bundle; `workspace.css` adds workspace refinements. Storefront styling is imported by its own layout. Homepage, shipping, packaging, product package controls and map styles are imported by their feature entry points. Preserve cascade order when moving rules and test both direct loads and client navigation: Next retains global styles after navigation. Prefer CSS Modules for new component-specific styles.

`RichText` uses `react-markdown` and `remark-gfm` without a client directive. Public product and article pages render Markdown on the server; interactive editor previews reuse the same renderer in their own chunks. Tables, task lists, strikethrough and footnotes are supported. Raw HTML and inline images remain disabled, unsafe link protocols are filtered, and unfinished Markdown stays literal rather than being repaired as a stream.

## Verification and size budgets

```sh
cd frontend
npm ci
npm run api:generate
npm run typecheck
npm run format:check
npm run test:unit
npm run build
# In another terminal, start the production build:
npm run start
npm run bundle:check
npm run test:e2e
```

The browser suite needs the isolated database/API setup documented in `docs/verification.md`; never run mutating fixtures against a working store database. `BASE_URL` selects a non-default running frontend; `CHROMIUM_PATH` can select a local Chromium binary.

`tools/check-bundle.mjs` reads initial production JS/CSS assets referenced by the rendered HTML, deduplicates them and compares gzip sizes with explicit budgets. It excludes images, font files, HTML, later navigation prefetches and on-demand chunks. CI checks `/about`, `/account` and `/staff`; browser tests cover the deferred cart, support, editors, maps and navigation. Review budget increases as architecture changes, not automatic maintenance.

Measured with the same asset-counting method before and after this refactor:

| Route | JS gzip before | JS gzip after | CSS gzip before | CSS gzip after |
| --- | ---: | ---: | ---: | ---: |
| `/about` | 197,253 B | 192,531 B | 32,523 B | 16,710 B |
| `/account` | 208,263 B | 204,949 B | 32,523 B | 19,359 B |
| `/staff` | 406,514 B | 204,396 B | 32,523 B | 20,792 B |

TypeScript rejects unused locals and parameters. Markdown rendering and security have unit coverage; tests assert semantic HTML rather than renderer-specific attributes. Keep generated API types generated, and keep future optional tools out of the shared route layouts.

Release references: [Next.js](https://www.npmjs.com/package/next), [React](https://github.com/facebook/react/releases), [Node.js](https://github.com/nodejs/node/releases). Package versions were also checked against the npm registry.

## Verification record (2026-10-27)

Validated with Node 26.12.1 and a production Next.js build. Type checking, formatting, Markdown unit tests, generated API-type consistency, and bundle budgets pass. The npm audit reports zero vulnerabilities and the application has no outdated direct packages. The pinned Node Alpine image manifest resolves for four platform entries.

Across the simulation, catalog and targeted live runs, 90 browser scenarios and three Markdown unit tests passed. The remaining dataset-gated analytics test was not run because its dedicated analytics SQL fixture was not installed; the other analytics journeys passed. Test fixtures were corrected to distinguish array customer orders from paginated staff orders, and to compare the monitoring banner with the actual API health status after deliberate failure tests.

Desktop monitoring and mobile product-editor screenshots were inspected. The full Docker image build and deployment were not performed. Test databases, uploads and runtime binaries were isolated under `/tmp/bomish-frontend-audit`; the system Node installation and working store data were not changed.
