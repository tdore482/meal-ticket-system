# Plan: Event-Based QR Meal Tickets with PDF Export

## Goals

1. **One QR code per user per event** — A single QR code works for the entire event (no 10-minute expiry).
2. **Track meal consumption** — Record which meal type (breakfast, lunch, supper) each user has redeemed per event.
3. **One meal per type per event** — Each user can redeem at most one breakfast, one lunch, and one supper per event.
4. **PDF export** — Export QR codes as printable PDFs for use at the event.

---

## Phase 1: Data Model Changes

### New / Modified Tables

| Table | Purpose |
|-------|---------|
| `events` | Event metadata (name, start_date, end_date, active) |
| `event_registrations` | Users enrolled in an event (user_id, event_id) |
| `event_qr_tokens` | One long-lived QR token per user per event (replaces per-meal `qr_tokens` for events) |
| `event_consumptions` | Tracks which meal types a user has consumed per event (user_id, event_id, meal_type_id) |

### Schema Additions

```sql
-- Events (e.g. "Annual Conference 2025", "Day 1")
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users registered for an event
CREATE TABLE event_registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- One QR token per user per event (long-lived, valid for event duration)
CREATE TABLE event_qr_tokens (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tracks which meal types user has consumed in this event
CREATE TABLE event_consumptions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  meal_type_id TEXT NOT NULL,
  consumed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  vendor_id TEXT,
  UNIQUE(event_id, user_id, meal_type_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (meal_type_id) REFERENCES meal_types(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);
```

### QR Data Format (Event Mode)

**Current:** `REG:{regNum}|TOKEN:{shortLivedToken}`

**New (event):** `EVT:{eventId}|REG:{regNum}|TOKEN:{eventToken}`

- `eventToken` is stable for the event (generated once per user per event).
- Validation checks: event active, user registered, meal type not yet consumed for this event.

---

## Phase 2: Backend API Changes

### Admin: Event Management

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/events` | GET | List events |
| `/api/admin/events` | POST | Create event |
| `/api/admin/events/:eventId` | GET | Event details + registrations |
| `/api/admin/events/:eventId/registrations` | POST | Add users to event (batch) |
| `/api/admin/events/:eventId/registrations` | DELETE | Remove user from event |
| `/api/admin/events/:eventId/generate-qr` | POST | Generate QR tokens for all registered users |
| `/api/admin/events/:eventId/export-pdf` | GET | Export QR codes as PDF |

### Vendor: Event-Aware Validation

| Change | Current | New |
|--------|---------|-----|
| QR validation | Uses `qr_tokens` (short-lived) | Uses `event_qr_tokens` when `EVT:` prefix present |
| Duplicate check | Token `used` flag | `event_consumptions` unique constraint |
| Meal type | From current time window | Vendor selects meal type (or inferred from time) |

### User: Event QR (Optional)

- Add optional flow: user logs in, selects event, views their event QR (same token as in PDF).
- Or: event QR is admin-generated only; users receive printed PDFs.

---

## Phase 3: PDF Export

### Approach

**Option A (recommended):** Backend PDF generation with `pdfkit` or `jspdf` + `node-canvas`.

- Endpoint: `GET /api/admin/events/:eventId/export-pdf`
- Query params: `?layout=per-page` (one QR per page) or `?layout=grid` (multiple per page)
- Each page: QR code + user name + reg number + event name

**Option B:** Frontend-only with `jspdf` + `qrcode` (no backend dependency).

- Slower for large batches; may hit memory limits on big exports.

### PDF Layout Example (per page)

```
┌─────────────────────────────────┐
│  Event: Annual Conference 2025   │
│  ─────────────────────────────  │
│                                 │
│        [ QR CODE IMAGE ]        │
│                                 │
│  John Doe                       │
│  REG001                         │
│                                 │
│  □ Breakfast  □ Lunch  □ Supper │
└─────────────────────────────────┘
```

---

## Phase 4: Vendor Scan Flow (Event Mode)

1. Vendor scans QR → parse `EVT:{eventId}|REG:{regNum}|TOKEN:{token}`.
2. Validate `event_qr_tokens` (event active, token matches user).
3. Determine meal type: **either** from current time window **or** vendor selects (e.g. "Breakfast" / "Lunch" / "Supper").
4. Check `event_consumptions`: has user already consumed this meal type for this event?
   - Yes → Deny: "Already redeemed [Breakfast]"
   - No → Allow: insert `event_consumptions`, return success.

---

## Phase 5: Coexistence

- **Legacy mode:** Keep existing `qr_tokens` + `meal_allocations` for non-event usage.
- **Event mode:** Use `event_qr_tokens` + `event_consumptions`.
- Validation logic branches on QR format: `EVT:` → event flow; otherwise → legacy flow.

---

## Implementation Order

1. **Schema** — Add `events`, `event_registrations`, `event_qr_tokens`, `event_consumptions`.
2. **Admin events API** — CRUD for events, add/remove registrations.
3. **Event QR generation** — One token per user per event; store in `event_qr_tokens`.
4. **Vendor validation** — Event flow: parse `EVT:` format, check `event_consumptions`.
5. **PDF export** — Install `pdfkit` (or similar), build layout, add export endpoint.
6. **Admin UI** — Event management, registration, "Export PDF" button.
7. **Vendor UI** — Optional meal-type selector when in event mode.

---

## Dependencies to Add

```json
"pdfkit": "^0.14.0"
```

(for backend PDF generation)

---

## Open Questions

1. **Event scope** — Is an event a single day, or multi-day? (Schema supports date range.)
2. **Meal type selection** — Vendor picks from dropdown, or inferred from current time?
3. **Legacy vs event** — Keep both modes long-term, or migrate fully to events?

---

## Implementation Complete ✓

**Setup for existing databases:**
```bash
npm install          # Installs pdfkit, qrcode
npm run migrate-events   # Adds event tables (or run init-db for fresh setup)
npm start
```

**Fresh setup:**
```bash
npm install
npm run init-db      # Creates all tables including events
npm start
```
