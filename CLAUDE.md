# Towne Parts — Project Context

## What This App Is
Parts management system for Towne Body Shop. Tracks repair orders (ROs), parts ordering/receiving, production board status, invoices, SRC (Swap/Return/Core) entries, supplement requests, inventory catalog, and a PIN-protected BMW payment tracker.

## Stack
- **Backend**: Node.js + Express, Prisma ORM, PostgreSQL (Railway)
- **Frontend**: React + Vite + Tailwind CSS + TanStack Query + Framer Motion
- **Deployed**: Railway — auto-deploys from `main` branch on GitHub push
- **Repo**: https://github.com/genejr88/towne-parts
- **URL**: https://parts.towneapps.com
- **Structure**: `backend/` and `frontend/` as separate packages

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/index.js` | Express entry point, mounts all routes |
| `backend/src/routes/ros.js` | RO CRUD, archive/unarchive, location photos |
| `backend/src/routes/parts.js` | Parts CRUD, bulk received, notes, photos |
| `backend/src/routes/production.js` | Production board GET (includes supplements), status save |
| `backend/src/routes/supplements.js` | Supplement request CRUD (`/api/supplements`) |
| `backend/src/routes/invoices.js` | RO invoice upload/list (`/invoices/ro/:roId`) |
| `backend/src/routes/import.js` | Text + photo (Tesseract OCR) parts import |
| `backend/src/routes/inventory.js` | Inventory catalog CRUD |
| `backend/src/routes/src.js` | SRC (Swap/Return/Core) tracker |
| `backend/src/routes/vendors.js` | Vendor management (isDefault support) |
| `backend/src/routes/private.js` | PIN-gated file storage (`PRIVATE_PIN` env var) |
| `backend/src/routes/bmw.js` | BMW payment tracker CRUD (`/api/bmw`) |
| `backend/src/routes/numbers.js` | Assigned-number sequence tracker (M#/GF#) CRUD + atomic "generate next" (`/api/numbers`) |
| `backend/src/routes/hitches.js` | Stealth Hitches quote builder — cached kit catalog, refresh-from-Stealth, quote CRUD (`/api/hitches`) |
| `backend/src/routes/auth.js` | JWT login/logout |
| `backend/src/routes/admin.js` | Admin-only actions |
| `backend/src/routes/users.js` | User management |
| `backend/src/routes/telegram.js` | Telegram notifications |
| `backend/prisma/schema.prisma` | Database models |
| `backend/prisma/seed.js` | Seeds admin user |
| `backend/prisma/seed-bmw.js` | One-time seed of 212 BMW payment records (Nov 2024 – Apr 2026) — skips if data exists |
| `frontend/src/App.jsx` | React Router routes |
| `frontend/src/pages/` | All pages — see list below |
| `frontend/src/lib/api.js` | All API calls (axios) — ALWAYS check paths here before adding new calls |
| `frontend/src/components/layout/BottomNav.jsx` | Bottom navigation (Parts, Board, Supps, S.R.C., Inventory, Admin) |

## Pages

| Page | Route | Notes |
|------|-------|-------|
| `Dashboard` | `/` | Activity feed, stats |
| `ROList` | `/ros` | All repair orders |
| `RODetail` | `/ros/:id` | Parts list, invoices, SRC, location photos |
| `ProductionBoard` | `/board` | Swipeable RO cards, stage/tech assignment |
| `SRCTracker` | `/src` | Swap/Return/Core management |
| `Supplements` | `/supplements` | All supplement requests grouped by RO, status management |
| `Inventory` | `/inventory` | Stock parts catalog |
| `SecureVault` | `/vault` | PIN-gated BMW Payment Tracker + file storage |
| `HitchQuotes` | `/hitches` | Stealth Hitches quote builder — search kit by vehicle, pick install tier, save/print/history |
| `Admin` | `/admin` | Admin panel |
| `RecentActivity` | `/recent` | Activity log |
| `Help` | `/help` | Help & guide accordion |
| `Login` | `/login` | Auth |

## Database Models
- `User` — staff accounts (ADMIN | USER roles)
- `Vendor` — parts vendors (name, phone, email, isActive, isDefault)
- `RO` — repair orders (roNumber, vehicle info, vendorId, partsStatus, productionStage, assignedTech, isTotalLoss, totalLossReleased, totalLossJobId, isArchived, owner/insurance fields)
- `Part` — parts per RO (qty, partNumber, description, dateOrdered, etaDate, finishStatus, isReceived, hasCore, price, notes, photos)
- `PartPhoto` — photos per part
- `ROInvoice` — invoice files per RO (fileType: INVOICE | ESTIMATE | OTHER)
- `ROLocationPhoto` — location/parking photos per RO
- `SRCEntry` — swap/return/core log (RETURN | CORE_RETURN types, OPEN → RETURNED → CREDITED)
- `SRCPhoto` — photos per SRC entry
- `ActivityLog` — event log per RO
- `PrivateFile` — PIN-gated file storage (for vault Files tab)
- `InventoryPart` — stock inventory catalog items
- `InventoryPartPhoto` — photos per inventory item
- `Supplement` — supplement requests per RO (number auto-increments within RO, status: REQUESTED | FILED | COMPLETED)
- `BMWPayment` — BMW payment tracking (month, year, date, lastName, bmwNumber, roNumber, amount, status: NOT_RECEIVED | RECEIVED)
- `NumberSequence` — per-program counter for the assigned-number tracker (program, prefix, current, padLength) — add a row to add a new program (e.g. Genesis of Milford → GM#)
- `AssignedNumber` — issued M#/GF# records (program, number, programRoNumber, towneRoNumber, vehicleYear/Make/Model, customerName) — number is freely editable after generation, deletable
- `HitchKit` — cached Stealth Hitches product catalog (shopifyId, title = vehicle fitment string, price, rackOnly) — refreshed on demand from Stealth's public Shopify JSON feed
- `HitchQuote` — saved hitch quotes (hitchKitId, vehicleTitle/kitPrice/tierFee snapshotted at quote time so history doesn't drift if prices change later, tier, shipping, tax, total, customer info)

## Auth
- JWT tokens, stored in `localStorage` under key `parts_token`
- Admin account: `gene` — see `backend/prisma/seed.js` for password
- `requireAuth` middleware on all protected routes
- PIN gate for vault: `PRIVATE_PIN` env var, checked via `x-private-pin` header in `requirePin` middleware (defined inline in `private.js` and `bmw.js`)

## Deployment / Railway Notes
- **Push to deploy**: `git push` → Railway auto-deploys from `main`
- **Builder**: Set to **Nixpacks** (NOT Railpack). Railpack was causing build failures due to its static env-var scanner requiring BuildKit secrets at build time. Nixpacks doesn't have this issue.
- **Metal Build Environment**: Must be **OFF** in Railway service Settings → Build. Metal forces Railpack even if Nixpacks is selected.
- Start script (in `backend/package.json`):
  `npx prisma db push --accept-data-loss && node prisma/seed.js && node prisma/seed-bmw.js && node src/index.js`
- `prisma db push --accept-data-loss` applies schema changes (NOT migrate deploy — this app uses db push)
- PostgreSQL via `DATABASE_URL` env var in Railway dashboard
- Uploads stored in `backend/uploads/` — **ephemeral on Railway** (lost on redeploy); private files and part photos do not persist
- `PRIVATE_PIN` env var must be set in Railway for vault access (default fallback: `TowneBMW2025`)
- **Dead dependencies removed**: `better-sqlite3` was in `package.json` but never used — it requires Python to compile from source on Nixpacks/Node 18 and would break builds if re-added. Do not add SQLite packages; this app is PostgreSQL only.

## Frontend Patterns
- TanStack Query: `useQuery`, `useMutation`, `useQueryClient`, `invalidateQueries`
- `unwrap(promise)` helper in api.js extracts `res.data.data` from API envelope `{ success, data }`
- API base URL via `VITE_API_URL` env var (Railway injects for prod; use `.env` in `frontend/` for local dev)
- Tailwind for all styling — dark theme (`gray-950` / `gray-900` backgrounds, `blue-600` accents)
- Framer Motion for animations and bottom sheet modals (`AnimatePresence`, `motion.div`)
- Bottom sheets slide up from `y: '100%'`, `spring` transition, `stiffness: 300, damping: 35`

## Critical API Path Notes
- Invoice routes: `GET|POST /api/invoices/ro/:roId` (NOT `/ros/:id/invoices`)
- Archive RO: `DELETE /api/ros/:id` (soft delete — sets `isArchived: true`)
- Unarchive: `POST /api/ros/:id/unarchive`
- Parts import text: `POST /api/import/text`
- Parts import photo/OCR: `POST /api/import/photo`
- Supplement auto-number: `POST /api/supplements/ro/:roId` assigns next `number` within that RO automatically
- BMW bulk import: `POST /api/bmw/bulk` — used by seed script, skipped if records already exist
- BMW summary: `GET /api/bmw/summary` — returns `[{month, year, invoiced, received, outstanding, count}]`
- Private PIN routes pass `x-private-pin` header (NOT Bearer token)

## Production Board — Key Behaviour
- `GET /api/production` returns non-archived ROs with: parts (id, isReceived, finishStatus, description, partNumber), locationPhotos, supplements (id, number, status), _count.srcEntries
- Supplement "Request" button is inside the Final Supplement card — one tap calls `POST /api/supplements/ro/:roId` with the RO's insurance company pre-filled, auto-numbers (Supplement 1, 2, 3…)
- Stage chip + Tech chip in the action bar are mutually exclusive accordions
- Debounced auto-save: 1200ms after last field change → `POST /api/production/:roId`
- `effectivePartsStatus(ro)` recalculates from parts array — defends against stale DB `partsStatus`

## BMW Payment Tracker (`/vault`)
- PIN-gated via `sessionStorage.getItem('private_pin')` — set when PIN is verified via `POST /api/private/verify`
- 4 tabs: **Tracker** (monthly view), **Compare** (all-months table + side-by-side delta), **Numbers** (M#/GF# assigned-number tracker), **Files** (PIN-gated file storage)
- Tracker: month nav (← →), stat cards (Invoiced / Received / Outstanding with "# BMW's Closed" sub-label), entry cards with one-tap status toggle
- Print: Tracker tab has "Print [Month Year]" button → opens styled print window; Compare tab has "Print" button → all-months table + optional comparison delta if two months selected
- Historical data: 212 records Nov 2024 – Apr 2026, seeded once via `seed-bmw.js`

## Assigned Numbers Tracker (`/vault` → Numbers tab)
- Tracks the M# sequence for BMW (currently at M1129, no zero-padding) and GF# for Genesis of Fairfield (zero-padded to 4 digits, e.g. GF0001) — separate books via the `program` field on `NumberSequence`/`AssignedNumber`
- "Generate Next" button: `POST /api/numbers/:program/next` atomically increments the `NumberSequence.current` counter inside a Prisma transaction (row-level lock prevents duplicate numbers on concurrent clicks) and creates a new `AssignedNumber` row with just the formatted number — the edit modal opens immediately so RO#/name/vehicle can be filled in
- The number itself is freely editable after generation (not locked to the counter's format), and records are hard-deletable — both by explicit choice, not an oversight
- To add a new program (e.g. Genesis of Milford → GM#): add a `NumberSequence` row (prefix `GM`, current `0`, padLength as desired) and add an entry to the `PROGRAMS` config in `frontend/src/components/AssignedNumbers.jsx` — no schema changes needed
- **TODO**: Telegram notification on Submit (full record: number + RO + name + vehicle) — not yet wired, pending bot token/chat ID setup (see `backend/src/routes/telegram.js` for the existing pattern to extend)

## Stealth Hitch Quote Builder (`/hitches`)
- Towne is an authorized Stealth Hitches installer (stealthhitches.com) — this tool lets office staff search a vehicle, pull the kit price, and build a quote without manually copying prices off Stealth's site
- **Catalog source**: stealthhitches.com is a Shopify store with a public, no-auth JSON feed — `https://stealthhitches.com/collections/hitches/products.json?limit=250` returns all ~127 kits with `title` (the vehicle fitment string, e.g. "2007-2011 BMW 3 Series Sedan Gas"), `sku`, `price`, `available`. No login/API key needed.
- Catalog is cached in `HitchKit` (not fetched live per-quote) — staff hits "Refresh Catalog" in the New Quote tab to re-sync; `POST /api/hitches/kits/refresh` upserts by `shopifyId`
- `rackOnly` is auto-detected via `/rack only/i` regex against the product title (7 of 127 kits as of Aug 2026: BMW X5, Audi Q5 PHEV, Polestar 2/3, Audi Q5/Q6/A6 e-tron, Volvo EX90) — editable per-kit via `PUT /api/hitches/kits/:id` in case the regex misfires on an edge case (e.g. "RACK ONLY OPTION AVAILABLE" phrasing)
- **Pricing**: kit cost = Stealth's listed price directly, no markup (Towne charges what Stealth charges) + one of 3 flat install fees + $40 shipping, taxed at 6.35%:
  - Rack Only — $800
  - Rack and Tow — $1,000
  - Rack and Tow w/ Active Wiring — $1,200
  - Config lives in `TIERS`/`SHIPPING`/`TAX_RATE` constants at the top of `backend/src/routes/hitches.js` — change fees there, not in the frontend
- If the matched kit is rack-only, the tier picker auto-restricts to just the Rack Only option (both client-side UI and server-side validation on `POST /api/hitches/quotes`)
- Quotes are saved with history (`HitchQuote`), searchable by customer name or vehicle; kit price and tier fee are snapshotted at save time so a later Stealth price change or fee adjustment doesn't retroactively alter old quotes
- Print via browser print window (same pattern as the BMW tracker's `openPrintWindow`, reimplemented standalone in `HitchQuotes.jsx`)
- Standalone tool for now — does not create an RO or Part record on save/accept (may be wired up later)

## Supplement Workflow
1. On Production Board → Final Supplement card → tap **Request** → logs `Supplement N` (REQUESTED status)
2. Navigate to `/supplements` (BottomNav "Supps" tab) to manage status
3. Supplements page: grouped by RO, filter All/Requested/Filed/Completed
   - REQUESTED: amber icon — one-tap "File" button (→ FILED), trash
   - FILED: green icon — "Complete" button (→ COMPLETED) + undo back to REQUESTED, trash; triggers Telegram notification when filed
   - COMPLETED: dimmed row, strikethrough title — "Undo" back to FILED, trash
   - Only REQUESTED supplements trigger the "Supp Pending" badge on the Production Board

## Current Feature State
- ✅ RO management: create, edit, archive (delivered), unarchive
- ✅ Parts per RO: add, edit, mark received, bulk received, notes, photos; received parts show green card + "HERE" badge
- ✅ Production board: swipeable cards, stage chip (inline accordion), tech chip (inline accordion), Final Supplement toggle + Request button, Total Loss + released toggle, Totals job badge, customer/insurance edit sheet, parts progress bar, delivery confirm
- ✅ Supplement requests: unlimited per RO, auto-numbered, Requested → Filed → Completed, dedicated management page
- ✅ Invoice upload per RO (PDF/image, fileType tagging)
- ✅ Photo import via Tesseract.js OCR (local, no AI tokens)
- ✅ Text/CCC file import for parts lists
- ✅ SRC tracker (swap, return, core entries with photos)
- ✅ Vendor management with default vendor
- ✅ Inventory catalog with photos
- ✅ Telegram notifications
- ✅ BMW Payment Tracker at `/vault` with monthly tracking, compare, print, and file storage
- ✅ Assigned Numbers tracker at `/vault` → Numbers tab (M# for BMW, GF# for Genesis of Fairfield, atomic generate-next)
- ✅ Stealth Hitch Quote Builder at `/hitches` — vehicle search against cached Stealth catalog, 3 flat install tiers, saved quote history, print
- ✅ Help page (`/help`)

## Planned / Known Issues
- Uploads are NOT persisted across Railway deploys (ephemeral storage) — consider object storage (S3/Cloudinary/DO Spaces) for production durability
- Tesseract OCR may be slow on Railway cold start (downloads language data on first use)
- `PRIVATE_PIN` must be set in Railway env vars or vault is inaccessible
