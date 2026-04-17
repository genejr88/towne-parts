# Towne Parts — Project Context

## What This App Is
Parts management system for Towne Body Shop. Tracks repair orders (ROs), parts ordering/receiving, production board status, invoices, SRC (Swap/Return/Core) entries, and a parts inventory catalog.

## Stack
- **Backend**: Node.js + Express, Prisma ORM, PostgreSQL (Railway)
- **Frontend**: React + Vite + Tailwind CSS + TanStack Query + Framer Motion
- **Deployed**: Railway — auto-deploys from `main` branch on GitHub push
- **Repo**: https://github.com/genejr88/towne-parts
- **Structure**: `backend/` and `frontend/` as separate packages

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/index.js` | Express entry point, mounts all routes |
| `backend/src/routes/ros.js` | RO CRUD, archive/unarchive |
| `backend/src/routes/parts.js` | Parts CRUD, bulk received, notes |
| `backend/src/routes/production.js` | Production board status updates |
| `backend/src/routes/invoices.js` | RO invoice upload/list (`/invoices/ro/:roId`) |
| `backend/src/routes/import.js` | Text + photo (Tesseract OCR) parts import |
| `backend/src/routes/inventory.js` | Inventory catalog CRUD |
| `backend/src/routes/src.js` | SRC (Swap/Return/Core) tracker |
| `backend/src/routes/vendors.js` | Vendor management |
| `backend/src/routes/auth.js` | JWT login/logout |
| `backend/src/routes/admin.js` | Admin-only actions |
| `backend/src/routes/users.js` | User management |
| `backend/src/routes/telegram.js` | Telegram notifications |
| `backend/prisma/schema.prisma` | Database models |
| `backend/prisma/seed.js` | Seeds admin user |
| `frontend/src/App.jsx` | React Router routes |
| `frontend/src/pages/` | Dashboard, ROList, RODetail, ProductionBoard, SRCTracker, Inventory, Admin, Login |
| `frontend/src/lib/api.js` | All API calls (axios) — ALWAYS check paths here before adding new calls |

## Database Models
- `User` — staff accounts (ADMIN | USER roles)
- `Vendor` — parts vendors
- `RO` — repair orders (roNumber, vehicle info, vendorId, partsStatus, productionStage, isArchived)
- `Part` — parts per RO (qty, partNumber, description, dates, isReceived, notes, price, photos)
- `PartPhoto` — condition photos per part
- `ROInvoice` — invoice files uploaded per RO
- `SRCEntry` — swap/return/core log entries per RO
- `ActivityLog` — event log per RO
- `InventoryPart` — stock inventory catalog items
- `InventoryPartPhoto` — photos per inventory item

## Auth
- JWT tokens, stored in localStorage
- Admin account: `gene` / (see seed.js) — re-seeded on every deploy
- `requireAuth` middleware on all protected routes

## Deployment / Railway Notes
- **Push to deploy**: `git add . && git commit -m "..." && git push` → Railway auto-deploys
- Start script: `npx prisma db push --accept-data-loss && node prisma/seed.js && node src/index.js`
- PostgreSQL connection via `DATABASE_URL` env var (set in Railway dashboard → Variables tab)
- Uploads stored in `backend/uploads/` (invoices/, parts/, inventory/) — Railway ephemeral storage, not persisted across deploys

## Frontend Patterns
- TanStack Query for all data fetching/mutations (`useQuery`, `useMutation`, `useQueryClient`, `invalidateQueries`)
- API base URL set via `VITE_API_URL` env var (Railway sets this for prod; `.env` in frontend/ for local)
- Tailwind for all styling — no custom CSS files
- Framer Motion for animations and bottom sheet modals (`AnimatePresence`)
- All API calls go through `frontend/src/lib/api.js` — always update this file when adding routes

## Critical API Path Notes
- Invoice routes: `GET /api/invoices/ro/:roId` and `POST /api/invoices/ro/:roId` (NOT `/ros/:id/invoices`)
- Archive RO: `DELETE /api/ros/:id` (NOT PUT /archive)
- Unarchive RO: `POST /api/ros/:id/unarchive`
- Parts import (text): `POST /api/import/text`
- Parts import (photo/OCR): `POST /api/import/photo`

## Current Feature State
- RO management: create, edit, archive (delivered), unarchive
- Parts per RO: add, edit, mark received, bulk mark all received, notes, photos
- Production board: kanban-style by stage, search/jump to RO, parts popup (received/missing), deliver button
- Invoice upload per RO (PDF/image)
- Photo import via Tesseract.js OCR (no AI tokens — local OCR)
- Text/CCC file import for parts lists
- SRC tracker (swap, return, core entries)
- Vendor management
- Inventory catalog with photos
- Telegram notification integration

## Planned / Known Issues
- Tesseract OCR on Railway requires language data download on first use — may be slow on cold start
- Upload files are NOT persisted across Railway deploys (Railway uses ephemeral storage)
- Photo import reliability depends on image quality and CCC format consistency
