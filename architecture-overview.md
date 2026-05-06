# Meal Ticket System - Architecture Overview

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (index.html)                        │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  User View   │  │ Vendor View  │  │  Admin View  │              │
│  │              │  │              │  │              │              │
│  │ - Dashboard  │  │ - Scanner    │  │ - Dashboard  │              │
│  │ - QR Gen     │  │ - Validate   │  │ - Events     │              │
│  │ - Meals      │  │ - Manual     │  │ - Users      │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
└─────────┼─────────────────┼─────────────────┼───────────────────────┘
          │                 │                 │
          │    API CALLS    │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND (server.js)                             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    AUTHENTICATION LAYER                         │ │
│  │  - Session Management  - Role-Based Access  - Rate Limiting    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ User Routes  │  │Vendor Routes │  │ Admin Routes │              │
│  │              │  │              │  │              │              │
│  │ /dashboard   │  │ /dashboard   │  │ /dashboard   │              │
│  │ /generate-qr │  │ /validate-qr │  │ /events      │              │
│  │              │  │              │  │ /users       │              │
│  │              │  │              │  │ /stats       │              │
│  │              │  │              │  │ /reconcile   │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
│         └─────────────────┼─────────────────┘                       │
│                           │                                         │
│  ┌────────────────────────▼──────────────────────────────────────┐ │
│  │                  BUSINESS LOGIC LAYER                          │ │
│  │                                                                │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │ │
│  │  │ Legacy Mode  │  │  Event Mode  │  │ Utilities    │        │ │
│  │  │              │  │              │  │              │        │ │
│  │  │ - Daily QR   │  │ - Event QR   │  │ - Time Calc  │        │ │
│  │  │ - Allocate   │  │ - Register   │  │ - Validation │        │ │
│  │  │ - Consume    │  │ - Consume    │  │ - Sanitize   │        │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────┘        │ │
│  │         │                 │                                   │ │
│  └─────────┼─────────────────┼───────────────────────────────────┘ │
│            │                 │                                     │
└────────────┼─────────────────┼─────────────────────────────────────┘
             │                 │
             ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DATABASE (meal_system.db)                         │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │    USERS     │  │  MEAL TYPES  │  │   VENDORS    │              │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤              │
│  │ id           │  │ id           │  │ id           │              │
│  │ reg_number   │  │ name         │  │ name         │              │
│  │ name         │  │ start_time   │  │ vendor_code  │              │
│  │ pin_hash     │  │ end_time     │  │ active       │              │
│  │ active       │  │ active       │  └──────────────┘              │
│  └──────────────┘  └──────────────┘                                │
│                                                                      │
│  ┌──────────────────────────────┐  ┌──────────────────────────┐    │
│  │    MEAL ALLOCATIONS          │  │     TRANSACTIONS         │    │
│  ├──────────────────────────────┤  ├──────────────────────────┤    │
│  │ id                           │  │ id                       │    │
│  │ user_id (FK)                 │  │ user_id (FK)             │    │
│  │ meal_type_id (FK)            │  │ vendor_id (FK)           │    │
│  │ allocated                    │  │ meal_type_id (FK)        │    │
│  │ remaining ( not used)      │  │ qr_token_id (FK)         │    │
│  │ consumed_count               │  │ transaction_date         │    │
│  └──────────────────────────────┘  │ transaction_time         │    │
│                                     └──────────────────────────┘    │
│                                                                      │
│  ┌──────────────────────────────┐  ┌──────────────────────────┐    │
│  │         EVENTS               │  │  EVENT REGISTRATIONS     │    │
│  ├──────────────────────────────┤  ├──────────────────────────┤    │
│  │ id                           │  │ id                       │    │
│  │ name                         │  │ event_id (FK)            │    │
│  │ start_date                   │  │ user_id (FK)             │    │
│  │ end_date                     │  └──────────────────────────┘    │
│  │ active                       │                                  │
│  └──────────────────────────────┘  ┌──────────────────────────┐    │
│                                     │  EVENT CONSUMPTIONS      │    │
│  ┌──────────────────────────────┐  ├──────────────────────────┤    │
│  │    EVENT QR TOKENS           │  │ id                       │    │
│  ├──────────────────────────────┤  │ event_id (FK)            │    │
│  │ id                           │  │ user_id (FK)             │    │
│  │ event_id (FK)                │  │ meal_type_id (FK)        │    │
│  │ user_id (FK)                 │  │ vendor_id (FK)           │    │
│  │ token                        │  │ consumed_at              │    │
│  └──────────────────────────────┘  └──────────────────────────┘    │
│                                                                      │
│  ┌──────────────────────────────┐  ┌──────────────────────────┐    │
│  │       QR TOKENS              │  │       SESSIONS           │    │
│  ├──────────────────────────────┤  ├──────────────────────────┤    │
│  │ id                           │  │ id                       │    │
│  │ user_id (FK)                 │  │ user_id (FK)             │    │
│  │ token                        │  │ vendor_id (FK)           │    │
│  │ expires_at                   │  │ admin_id (FK)            │    │
│  │ used (0/1)                   │  │ session_token            │    │
│  └──────────────────────────────┘  │ expires_at               │    │
│                                     └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Legacy Mode Transaction

```
┌─────────┐
│  USER   │
└────┬────┘
     │ 1. Login (POST /api/auth/login)
     ▼
┌─────────────────────────────────────┐
│ Session Created                     │
│ Token: ABC123...                    │
└────┬────────────────────────────────┘
     │ 2. View Dashboard (GET /api/user/dashboard)
     ▼
┌─────────────────────────────────────┐
│ Query:                              │
│ SELECT allocated - COUNT(t.id)      │
│ FROM meal_allocations ma            │
│ LEFT JOIN transactions t ...        │
│                                     │
│ Result: Breakfast: 15 remaining     │
└────┬────────────────────────────────┘
     │ 3. Generate QR (POST /api/user/generate-qr)
     ▼
┌─────────────────────────────────────┐
│ Check: Is active meal period?       │
│ → Yes (07:00-09:00, now 07:30)      │
│                                     │
│ Create QR Token:                    │
│ - Token: XYZ789                     │
│ - Expires: 10 minutes               │
│ - Format: REG:REG001|TOKEN:XYZ789   │
└────┬────────────────────────────────┘
     │ 4. Show QR to Vendor
     ▼
┌──────────┐
│  VENDOR  │
└────┬─────┘
     │ 5. Scan QR (POST /api/vendor/validate-qr)
     ▼
┌─────────────────────────────────────┐
│ Validate:                           │
│ ✓ Token exists                      │
│ ✓ Not expired                       │
│ ✓ Not used                          │
│ ✓ Active meal period                │
│ ✓ User has meals remaining          │
└────┬────────────────────────────────┘
     │ 6. Record Transaction
     ▼
┌─────────────────────────────────────┐
│ BEGIN TRANSACTION                   │
│                                     │
│ 1. Mark token as used               │
│    UPDATE qr_tokens SET used=1      │
│                                     │
│ 2. Insert transaction               │
│    INSERT INTO transactions ...     │
│                                     │
│ COMMIT                              │
└────┬────────────────────────────────┘
     │ 7. User Refreshes Dashboard
     ▼
┌─────────────────────────────────────┐
│ Real-time Calculation:              │
│ Allocated: 20                       │
│ Consumed: 5 (from transactions)     │
│ Remaining: 15                       │
└─────────────────────────────────────┘
```

---

## Data Flow: Event Mode Transaction

```
┌─────────┐
│  ADMIN  │
└────┬────┘
     │ 1. Create Event (POST /api/admin/events)
     ▼
┌─────────────────────────────────────┐
│ Event: "Annual Conference 2026"     │
│ Dates: 2026-03-01 to 2026-03-03     │
└────┬────────────────────────────────┘
     │ 2. Register Users (POST /api/admin/events/:id/registrations/all)
     ▼
┌─────────────────────────────────────┐
│ 150 users registered                │
└────┬────────────────────────────────┘
     │ 3. Generate QR Tokens (POST /api/admin/events/:id/generate-qr)
     ▼
┌─────────────────────────────────────┐
│ 150 event QR tokens created         │
│ Format: EVT:EV123|REG:REG001|...    │
│ Valid for entire event duration     │
└────┬────────────────────────────────┘
     │ 4. Export PDF (GET /api/admin/events/:id/export-pdf)
     ▼
┌─────────────────────────────────────┐
│ PDF Generated:                      │
│ - 6 tickets per page                │
│ - 25 pages total                    │
│ - QR codes + user info              │
└────┬────────────────────────────────┘
     │ 5. Print and distribute to users
     ▼
┌─────────┐
│  USER   │
└────┬────┘
     │ 6. Show QR at meal time
     ▼
┌──────────┐
│  VENDOR  │
└────┬─────┘
     │ 7. Scan Event QR (POST /api/vendor/validate-qr)
     ▼
┌─────────────────────────────────────┐
│ Parse QR:                           │
│ - Event ID: EV123                   │
│ - Reg Number: REG001                │
│ - Token: ABC123                     │
│                                     │
│ Validate:                           │
│ ✓ Event exists and active           │
│ ✓ User registered for event         │
│ ✓ Token matches                     │
│ ✓ Not already consumed this meal    │
└────┬────────────────────────────────┘
     │ 8. Record Consumption
     ▼
┌─────────────────────────────────────┐
│ INSERT INTO event_consumptions      │
│ - event_id: EV123                   │
│ - user_id: U001                     │
│ - meal_type_id: M1 (Breakfast)      │
│ - vendor_id: V1                     │
│ - consumed_at: NOW()                │
└────┬────────────────────────────────┘
     │ 9. Admin Views Report
     ▼
┌─────────────────────────────────────┐
│ Consumption Report:                 │
│ Breakfast: 145/150 (97%)            │
│ Lunch: 142/150 (95%)                │
│ Dinner: 138/150 (92%)               │
└─────────────────────────────────────┘
```

---

## Key Architectural Decisions

### Real-Time Data Calculation
**Decision**: Calculate remaining meals from transactions, not from stored field 
**Rationale**: Ensures data accuracy, prevents drift 
**Implementation**: JOIN queries in dashboard endpoints 

### Dual-Mode Operation
**Decision**: Separate tables for legacy vs event mode 
**Rationale**: Different use cases, different lifecycles 
**Implementation**: `transactions` vs `event_consumptions` 

### Time-Based Meal Detection
**Decision**: Use utility functions for time comparison 
**Rationale**: Handles edge cases (cross-midnight, DST) 
**Implementation**: `isTimeInRange()`, `findActiveMeal()` 

### Token Security
**Decision**: Short-lived tokens for legacy, long-lived for events 
**Rationale**: Balance security vs usability 
**Implementation**: 10min expiry vs event duration 

### Pagination
**Decision**: LIMIT/OFFSET with total count 
**Rationale**: Scalability for large datasets 
**Implementation**: All admin list endpoints 

---

## Performance Optimizations

1. **Database Optimizations**
 - WAL mode for concurrent reads/writes
 - Indexes on foreign keys
 - PRAGMA synchronous=NORMAL

2. **Query Optimizations**
 - JOIN instead of N+1 queries
 - Aggregate functions for counts
 - Pagination to limit result sets

3. **Caching Strategy**
 - Session tokens cached in memory
 - Rate limiting with in-memory map
 - Auto-cleanup of expired entries

---

## Security Layers

```
┌─────────────────────────────────────┐
│  1. Rate Limiting                   │
│     500 requests/min per endpoint   │
└────┬────────────────────────────────┘
     │
┌────▼────────────────────────────────┐
│  2. Input Validation                │
│     Sanitize all user inputs        │
└────┬────────────────────────────────┘
     │
┌────▼────────────────────────────────┐
│  3. Authentication                  │
│     Session token verification      │
└────┬────────────────────────────────┘
     │
┌────▼────────────────────────────────┐
│  4. Authorization                   │
│     Role-based access control       │
└────┬────────────────────────────────┘
     │
┌────▼────────────────────────────────┐
│  5. SQL Injection Protection        │
│     Parameterized queries only      │
└────┬────────────────────────────────┘
     │
┌────▼────────────────────────────────┐
│  6. Password Security               │
│     bcrypt hashing with salt        │
└─────────────────────────────────────┘
```

---

## Monitoring & Health Checks

### Available Endpoints

1. **`GET /api/health`**
 - Returns: `{ status: 'ok', database: 'connected' }`
 - Use: Basic uptime monitoring

2. **`GET /api/admin/reconciliation/validate`**
 - Returns: Data integrity issues
 - Use: Periodic health checks

3. **`POST /api/admin/sync/meal-allocations`**
 - Returns: Sync results
 - Use: Fix discrepancies if found

---

## Deployment Checklist

- [ ] Environment variables configured (`.env`)
- [ ] Database initialized (`npm run init-db`)
- [ ] Dependencies installed (`npm install`)
- [ ] Server starts successfully (`npm start`)
- [ ] Health check passes (`/api/health`)
- [ ] Admin can login
- [ ] User can login and generate QR
- [ ] Vendor can scan QR
- [ ] Reconciliation check passes

---

This architecture supports:
- 1000+ concurrent users
- 10,000+ transactions per day
- Real-time dashboard updates
- Dual-mode operation
- Data integrity validation
- Comprehensive security
