# Meal Ticket Management System

A web-based meal management system for tracking meal consumption at events and conferences. Supports QR code scanning, multi-day events, PDF ticket export, and real-time reporting.

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [User Roles](#user-roles)
5. [Features](#features)
6. [Database Schema](#database-schema)
7. [API Reference](#api-reference)
8. [Deployment](#deployment)
9. [Troubleshooting](#troubleshooting)

---

## Overview

This system manages meal allocation and redemption for events (conferences, workshops, etc.) where participants receive meals based on their registration. It supports two modes:

- **Legacy Mode** - Traditional per-meal QR tokens with time-limited validity
- **Event Mode** - Long-lived QR codes valid for an entire event (multi-day support)

---

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (Supabase, Neon, or local)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your database credentials

# 3. Initialize database (creates all tables)
npm run setup-db

# 4. Start the server
npm start
```

The server runs at `http://localhost:3000`.

### Default Credentials

| Role | Username/Code | Password/PIN |
|------|---------------|--------------|
| Admin | admin | admin123 |
| User | REG001 | 1234 |
| Vendor | cafe_a | (code only) |

---

## Architecture

```
meal-ticket/
├── server.js           # Express.js API server (all routes)
├── db.js               # PostgreSQL database abstraction layer
├── csv-parser.js       # CSV/TSV/TXT file parser for user import
├── public/
│   └── index.html      # Single-page frontend (HTML + CSS + JS)
├── api/
│   └── index.js        # Vercel serverless entry point
├── schema-postgres.sql # PostgreSQL schema definition
├── vercel.json         # Vercel deployment config
├── .env                # Environment variables (not committed)
└── package.json        # Dependencies and scripts
```

**Technology Stack:**
- **Backend:** Express.js + PostgreSQL (via `pg` driver)
- **Frontend:** Vanilla HTML/CSS/JavaScript (single-page app)
- **PDF Generation:** PDFKit (server-side)
- **QR Codes:** `qrcode` npm package (server), `qrcodejs` + `html5-qrcode` (client)
- **Deployment:** Vercel (serverless)

---

## User Roles

### Admin
- Full system access
- Manage users, vendors, events
- View all reports and analytics
- Edit meal schedules and allocations
- Export PDFs (QR tickets, reports)
- Bulk import users from CSV

### User (Participant)
- View personal meal balance
- Generate QR ticket codes
- See active meal period and remaining meals

### Vendor (Caterer)
- Scan QR codes to validate and redeem meals
- Manual code entry fallback
- View current serving status
- Select meal type (for event mode)

---

## Features

### 1. User Management
- Register new participants (name, reg number, PIN)
- Bulk import from CSV/TSV/TXT files (auto-detects format)
- Accommodation toggle (Y = 12 meals/type, N = 4 meals/type)
- Individual meal allocation editing

### 2. Meal Schedule
- View and edit meal period names and time windows
- Enable/disable individual meal types
- Changes apply immediately to QR validation and vendor scanning

### 3. Event Management
- Create multi-day events with date ranges
- Register users to events (individually or bulk)
- Generate unique QR tokens per user per event
- Export printable PDF tickets (6 per page, 2x3 grid)

### 4. QR Code System
- **Legacy Mode:** `REG:{regNum}|TOKEN:{token}` - 10-minute expiry
- **Event Mode:** `EVT:{eventId}|REG:{regNum}|TOKEN:{token}` - valid for event duration
- Camera scanning (mobile-friendly) + manual entry fallback

### 5. Vendor Scanning
- Real-time QR validation
- Automatic meal type detection from current time
- Manual meal type selection for events
- Approval/denial feedback with remaining count

### 6. Reporting
- **Daily Summary** - Today's consumption stats
- **Live Feed** - Real-time transaction stream (auto-refreshes)
- **Consolidated Report** - All transactions grouped by meal period
- **Daily Matrix** - Date x meal type grid with totals
- **Meals Per Day** - Historical daily consumption
- **Meals Per Time** - Hourly breakdown with peak detection
- **PDF Export** - Print-ready reports

### 7. System Maintenance
- Database repair (fix denial restrictions for multi-day meals)
- Meal balance reset to defaults
- Data reconciliation and validation

---

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | Participant records (name, reg number, PIN hash, accommodation) |
| `vendors` | Catering vendor accounts |
| `admins` | Admin login accounts |
| `meal_types` | Meal periods (breakfast, lunch, supper) with time windows |
| `meal_allocations` | Per-user meal balance tracking |
| `sessions` | Active login sessions |
| `qr_tokens` | Legacy QR tokens (short-lived) |

### Event Tables

| Table | Purpose |
|-------|---------|
| `events` | Event metadata (name, date range, active status) |
| `event_registrations` | User-to-event enrollment |
| `event_qr_tokens` | Long-lived event QR tokens |
| `event_consumptions` | Meal redemption records per event |

### Transaction Tables

| Table | Purpose |
|-------|---------|
| `transactions` | Legacy meal redemption records |
| `event_consumptions` | Event-mode meal redemption records |

---

## API Reference

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Login (user/vendor/admin) |
| `/api/auth/register` | POST | Register new user |
| `/api/auth/logout` | POST | End session |
| `/api/health` | GET | Health check |

### User

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/user/dashboard` | GET | Meal balance and active period |
| `/api/user/generate-qr` | POST | Generate QR token |

### Vendor

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vendor/dashboard` | GET | Vendor info and meal stats |
| `/api/vendor/validate-qr` | POST | Scan and validate QR code |

### Admin - Dashboard & Reports

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/dashboard` | GET | Today's stats with pagination |
| `/api/admin/daily-summary` | GET | Comprehensive daily summary |
| `/api/admin/daily-breakdown` | GET | Legacy + event breakdown |
| `/api/admin/consolidated-report` | GET | All transactions by meal period |
| `/api/admin/reports` | GET | Full report with filtering |
| `/api/admin/stats/meals-per-day` | GET | Daily consumption history |
| `/api/admin/stats/meals-per-time` | GET | Hourly breakdown |
| `/api/admin/stats/daily-matrix` | GET | Date x meal type grid |

### Admin - User Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/users` | GET | List all users |
| `/api/admin/users/:id` | GET | User details + meals |
| `/api/admin/users/:id/meals` | POST | Update meal allocations |
| `/api/admin/users/:id/accommodation` | POST | Change accommodation |
| `/api/admin/users/bulk-import` | POST | Import users from CSV |

### Admin - Event Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/events` | GET/POST | List/create events |
| `/api/admin/events/:id` | GET | Event details + registrations |
| `/api/admin/events/:id/registrations` | POST/DELETE | Manage registrations |
| `/api/admin/events/:id/registrations/all` | POST | Register all users |
| `/api/admin/events/:id/generate-qr` | POST | Generate event QR tokens |
| `/api/admin/events/:id/export-pdf` | GET | Download QR ticket PDF |
| `/api/admin/events/:id/consumption-report` | GET | Per-user consumption report |
| `/api/admin/events/:id/live-feed` | GET | Real-time event transactions |

### Admin - Meal Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/meal-types` | GET | List all meal types |
| `/api/admin/meal-types/:id` | PUT | Update meal type |
| `/api/admin/allocate-meals` | POST | Bulk allocate meals |
| `/api/admin/allocate-meals/all` | POST | Allocate to all users |

### Admin - Maintenance

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/fix-database` | POST | Repair database structure |
| `/api/admin/reconciliation/validate` | GET | Check data consistency |
| `/api/admin/sync/meal-allocations` | POST | Recalculate remaining counts |
| `/api/admin/sync/event-consumptions` | POST | Validate event data |

---

## Deployment

### Vercel

1. Push to GitHub
2. Connect repository to Vercel
3. Set environment variables in Vercel dashboard:
   - `DATABASE_URL` - PostgreSQL connection string
   - `CORS_ORIGIN` - `*` or your domain
4. Deploy

The `api/index.js` file serves as the serverless function entry point. Static files in `public/` are served automatically.

### Environment Variables

```env
PORT=3000                    # Server port (local dev)
NODE_ENV=development          # development | production
DATABASE_URL=postgresql://...  # PostgreSQL connection string
CORS_ORIGIN=*                 # Allowed origins
SESSION_TIMEOUT=86400000      # Session expiry (24h in ms)
```

---

## Troubleshooting

### Server won't start
- Check `DATABASE_URL` in `.env` is valid
- Ensure PostgreSQL database exists and schema is created (`npm run setup-db`)
- Check firewall/network allows connection to database

### Meal Schedule tab shows "Error loading meal types"
- Server must be running for any admin tab to load data
- Ensure you're logged in as admin
- Check browser console for API errors

### QR codes not scanning
- Ensure camera permissions granted in browser
- Try manual entry as fallback
- Check QR data format matches expected pattern

### Meal counts incorrect
- Use System Maintenance > "Reset All to 10/10 Balance"
- Or use "Fix Denial Restrictions" for multi-day meal issues

---

## Meal Schedule Tab - How It Works

The Meal Schedule tab allows admins to configure meal periods:

1. **Navigate** to Admin > Meal Schedule tab
2. **View** current meal types (e.g., Breakfast 06:00-10:00, Lunch 12:00-15:00, Supper 18:00-21:00)
3. **Edit** name, start time, end time for each meal
4. **Toggle** active/inactive status
5. **Save** changes (applies immediately to QR validation)

The schedule controls:
- Which meal is "active" for user QR generation
- Which meal vendors can redeem against
- Time-based meal type detection during scanning
