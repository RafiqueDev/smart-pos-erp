# Smart POS ERP — Complete System Architecture Blueprint

## Final Technology Decisions

| Concern | Decision |
|---|---|
| Caching + Jobs | Redis + BullMQ |
| Offline Web | PWA — IndexedDB + Service Worker |
| Offline Mobile | SQLite (expo-sqlite) |
| File Storage | Cloudinary |
| Branch Scope | Configurable per role (Admin-controlled) |
| DB Migrations | migrate-mongo + document schema versioning |
| SMS Gateway | Twilio primary + Pakistani gateway fallback |
| Deployment | Docker Compose (dev) / Docker Swarm (prod) |

---

## 1. Multi-Tenant Isolation Strategy

**Approach: Single Database + companyId Isolation**

Every document in every collection carries a mandatory `companyId` field.
The backend is the **only** source of truth — companyId is NEVER trusted from the frontend.

```
Request Flow:
  HTTP Request
    → Rate Limiter
    → Helmet / CORS
    → JWT Verification           (extracts userId, companyId, role, branchId)
    → Tenant Isolation MW        (injects req.tenantFilter = { companyId })
    → Branch Scope MW            (injects req.branchFilter based on role settings)
    → RBAC Authorization         (checks role permission for route)
    → Resource Ownership Guard   (verifies document belongs to tenant)
    → Controller                 (ALWAYS spreads tenantFilter into every query)
    → Audit Logger               (logs action with companyId)
    → Response
```

### JWT Payload Structure
```json
{
  "sub": "uuid-v4-user-id",
  "companyId": "uuid-v4-company-id",
  "branchId": "uuid-v4-branch-id",
  "role": "admin | manager | salesman",
  "branchScope": "own | all | configurable",
  "type": "access",
  "iat": 1700000000,
  "exp": 1700003600
}
```

### Tenant Isolation Rules
- `companyId` comes from JWT ONLY — never from request body/params/query
- Every Mongoose query includes `{ companyId: req.user.companyId }`
- Branch managers get `branchId` injected based on role settings
- DevAdmin JWT has no `companyId` — operates outside tenant system

---

## 2. Docker Service Map

```
┌─────────────────────────────────────────────────┐
│                  Docker Network                  │
│                                                  │
│  ┌──────────┐    ┌──────────┐   ┌────────────┐  │
│  │  Nginx   │───▶│ Frontend │   │  Backend   │  │
│  │ :80/:443 │    │  :5173   │   │   :5000    │  │
│  └──────────┘    └──────────┘   └─────┬──────┘  │
│       │                               │         │
│       └──────────────────────────────▶│         │
│                                       │         │
│  ┌──────────┐    ┌──────────┐         │         │
│  │ MongoDB  │◀───│ Backend  │─────────┘         │
│  │  :27017  │    │          │                   │
│  └──────────┘    └──────────┘                   │
│                                                  │
│  ┌──────────┐    ┌──────────┐                   │
│  │  Redis   │◀───│  BullMQ  │                   │
│  │  :6379   │    │ Workers  │                   │
│  └──────────┘    └──────────┘                   │
└─────────────────────────────────────────────────┘
```

---

## 3. MongoDB Collection Map

All collections (except DevAdmin system) are filtered by companyId.

```
DEVELOPER SYSTEM (no companyId):
  dev_users          → Super admin accounts
  licenses           → Company license records
  activation_keys    → Generated activation keys
  support_tickets    → Customer support
  system_health      → Monitoring data
  software_versions  → Version control

TENANT COLLECTIONS (ALL require companyId):
  companies          → Tenant master records
  users              → Company users (admin/manager/salesman)
  branches           → Physical branches per company
  warehouses         → Warehouses per branch
  products           → Products with soft-delete
  categories         → Product categories
  brands             → Product brands
  customers          → Customer records
  vendors            → Supplier records
  sales              → Sale/Invoice records
  sale_items         → Line items (denormalized for perf)
  purchases          → Purchase orders
  purchase_items     → PO line items
  payments           → Payment transactions
  bank_accounts      → Company bank accounts
  stock_movements    → Every stock change (audit trail)
  notifications      → In-app notifications
  settings           → Company & branch settings
  audit_logs         → All critical action logs

SHARED:
  migrations         → Schema migration tracking
  otp_tokens         → SMS/Email OTP codes
```

---

## 4. Indexing Strategy

```javascript
// Every tenant collection gets these compound indexes:
{ companyId: 1, createdAt: -1 }          // default list queries
{ companyId: 1, branchId: 1 }            // branch-scoped queries
{ companyId: 1, isDeleted: 1 }           // soft-delete filter
{ companyId: 1, status: 1 }              // status filters

// Collection-specific:
products:   { companyId:1, sku:1 } unique, { companyId:1, barcode:1 }
users:      { companyId:1, email:1 } unique
sales:      { companyId:1, invoiceNumber:1 } unique
customers:  { companyId:1, phone:1 }
```

---

## 5. Redis Architecture (BullMQ)

```
Queues:
  email-queue        → Transactional emails (invoices, alerts)
  sms-queue          → OTP, invoice SMS (Twilio + PK fallback)
  notification-queue → Push + in-app notifications
  backup-queue       → Scheduled DB backups
  report-queue       → Heavy report generation
  sync-queue         → Offline POS sync processing

Cache Keys (with TTL):
  dashboard:{companyId}:{branchId}   → 60s
  product-list:{companyId}:{page}    → 30s
  user:{userId}                      → 300s
  settings:{companyId}               → 600s
```

---

## 6. Offline-First POS Architecture

```
WEB (PWA):
  Service Worker → intercepts API calls
  IndexedDB      → stores pending sales, products cache
  Sync Engine    → on reconnect, POST /api/erp/pos/sync-offline
  Conflict res.  → server timestamp wins

MOBILE (React Native):
  expo-sqlite    → local SQLite database
  Background sync → NetInfo.addEventListener
  Queue table    → offline_queue (action, payload, timestamp)
  Auto-sync      → processes queue on network restore
```

---

## 7. Branch Scope Permission Matrix

```
Role          | Own Branch Only | All Branches | Configurable
──────────────|─────────────────|──────────────|─────────────
Company Admin | ✗               | ✓ (always)   | N/A
Manager       | default         | optional     | ✓ Admin sets
Salesman      | ✓ (always)      | ✗            | N/A
```

---

## 8. Security Architecture

```
Layer 1 — Transport:   HTTPS, HSTS, secure cookies
Layer 2 — Auth:        JWT access (15m) + refresh (7d) in httpOnly cookie
Layer 3 — Tenant:      companyId from JWT only, injected middleware
Layer 4 — RBAC:        Role + permission matrix per route
Layer 5 — Ownership:   Document-level companyId verify before return
Layer 6 — Input:       express-validator + mongoSanitize + xss-clean
Layer 7 — Rate:        Global 100/min + auth 5/min + pos 500/min
Layer 8 — Audit:       Every mutation logged to audit_logs collection
Layer 9 — IDs:         UUID v4 for all public-facing IDs (no ObjectIds in URLs)
```

---

## 9. SMS Gateway Strategy (Pakistan)

```
Primary:  Twilio (global, reliable, high deliverability)
Fallback: EasySMS / SMS.to / Zong/Jazz API (local PK)

Logic:
  1. Try Twilio
  2. On failure → try local PK gateway
  3. On both fail → queue for retry (BullMQ)
  4. Log all attempts in audit_logs
```

---

## 10. File Structure Overview

```
smart-pos-erp/
├── backend/
│   ├── src/
│   │   ├── config/          database, redis, socket, cloudinary, bullmq
│   │   ├── controllers/     dev/, erp/, shared/
│   │   ├── middleware/      auth, tenant, branch, rbac, ratelimit, error, audit
│   │   ├── models/          dev/, erp/, shared/
│   │   ├── queues/          index.js + workers/
│   │   ├── routes/          dev/, erp/
│   │   ├── services/        email, sms, cloud, cache, license, stock, sync
│   │   ├── sockets/         manager, pos, dashboard, inventory, notify
│   │   ├── utils/           logger, jwt, crypto, ApiResponse, ApiError, pagination
│   │   └── validators/      auth, product, sale, customer, vendor
│   ├── migrations/          migrate-mongo migration files
│   ├── scripts/             seedDevAdmin, seedDemo
│   └── server.js
├── frontend/
│   ├── src/
│   │   ├── apps/
│   │   │   ├── developer/   Super Admin SaaS Panel (dark futuristic)
│   │   │   └── erp/         Company ERP Dashboard (clean business)
│   │   ├── components/      common/, ui/
│   │   ├── hooks/           useAuth, useSocket, useOffline, usePermission
│   │   ├── services/        api, socket, offline, cache
│   │   ├── store/           Redux Toolkit slices
│   │   ├── utils/           formatters, validators, constants
│   │   └── workers/         sw.js (Service Worker)
├── mobile/
│   ├── src/
│   │   ├── screens/         auth/, dashboard/, pos/
│   │   ├── db/              SQLite schema, offline queue
│   │   ├── services/        api, sync, notifications
│   │   └── navigation/      root, auth, erp stacks
├── nginx/                   nginx.conf, ssl config
├── docs/                    API.md, INSTALL.md, USER_GUIDE.md
├── scripts/                 backup.sh, deploy.sh
├── docker-compose.yml       Development
├── docker-compose.prod.yml  Production
└── README.md
```
