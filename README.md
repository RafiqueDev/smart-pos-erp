# Smart POS ERP — Enterprise Multi-Tenant SaaS System

> Production-grade, real-time POS + ERP SaaS platform for wholesale and retail businesses.

---

## ✨ Features

| Area | Features |
|------|----------|
| **POS** | Barcode scanning, offline mode, hold invoices, returns, multi-payment |
| **Inventory** | Real-time stock, low-stock alerts, QR/barcode generation, adjustments |
| **Customers** | Ledger, credit limits, purchase history, PDF/Excel export |
| **Vendors** | Purchase orders, payment tracking, ledger |
| **Reports** | Sales, P&L, inventory, daily/weekly/monthly/yearly, export |
| **Accounting** | Cash tracking, bank transfers, payment breakdown |
| **Multi-tenant** | Complete data isolation per company, UUID IDs |
| **Multi-branch** | Branch-wise inventory, reporting, configurable manager scope |
| **Real-time** | Socket.IO dashboard, stock alerts, sale notifications |
| **Offline** | PWA (IndexedDB) for web, SQLite for mobile, auto-sync |
| **Security** | JWT + refresh tokens, RBAC, tenant isolation, audit logs |
| **Dev Admin** | License management, activation keys, SaaS analytics |
| **Mobile** | React Native with barcode scanner and offline POS |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Docker Network                           │
│                                                                   │
│   Nginx :80/:443                                                  │
│      ↓                                                            │
│   Frontend :5173  ←───→  Backend :5000  ←───→  MongoDB :27017   │
│   (React + Vite)          (Express.js)           (Mongoose)      │
│       PWA                    ↕                                    │
│   IndexedDB           Socket.IO / JWT                             │
│   Offline Sync              ↕                                     │
│                          Redis :6379                              │
│                         (BullMQ + Cache)                         │
│                                                                   │
│   Mobile (React Native) ←───→ Same Backend APIs                  │
│         SQLite offline sync                                       │
└──────────────────────────────────────────────────────────────────┘
```

**Two completely separate panels:**
- `/dev/*` → **Developer Super-Admin Panel** (dark futuristic UI)
- `/*`     → **Company ERP Dashboard** (clean business UI)

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Redux Toolkit, Framer Motion, Recharts |
| Backend | Node.js 20, Express.js, Socket.IO, BullMQ |
| Database | MongoDB 7, Mongoose 8 |
| Cache / Queue | Redis 7, BullMQ 5 |
| File Storage | Cloudinary |
| SMS | Twilio + Pakistani gateway fallback |
| Auth | JWT (access 15m + refresh 7d, httpOnly cookies) |
| Mobile | React Native (Expo), SQLite offline |
| DevOps | Docker, Docker Compose, Nginx |
| Migrations | migrate-mongo |

---

## 🚀 Quick Start

### Prerequisites

- Docker Desktop (recommended) **OR** Node.js 20+, MongoDB 7, Redis 7
- Git

### Option A — Docker (Recommended)

```bash
# 1. Clone
git clone https://github.com/yourname/smart-pos-erp.git
cd smart-pos-erp

# 2. Environment
cp backend/.env.example backend/.env
# Edit backend/.env — fill in Cloudinary, SMTP, JWT secrets

# 3. Start all services
docker-compose up -d

# 4. Wait ~30s for services to be healthy, then seed
docker-compose exec backend npm run seed:dev
docker-compose exec backend npm run seed:demo

# 5. Run migrations
docker-compose exec backend npm run migrate:up

# 6. Open browser
# ERP Dashboard:  http://localhost:80
# Dev Panel:      http://localhost:80/dev
```

### Option B — Local Development

```bash
# Terminal 1 — Start MongoDB
mongod --dbpath /data/db

# Terminal 2 — Start Redis
redis-server

# Terminal 3 — Backend
cd backend
cp .env.example .env     # fill in your values
npm install
npm run seed:dev          # create dev admin
npm run seed:demo         # create demo company
npm run migrate:up        # run migrations
npm run dev               # starts on :5000

# Terminal 4 — Frontend
cd frontend
npm install
npm run dev               # starts on :5173
```

---

## 🔐 Default Credentials

### Developer Admin Panel (`/dev`)
| Field | Value |
|-------|-------|
| Email | `dev@smartposerp.com` |
| Password | `DevAdmin@2024!` |

### Company ERP Dashboard (`/`)
| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@democompany.com` | `Admin@2024!` |
| Manager | `manager@democompany.com` | `Manager@2024!` |
| Salesman | `salesman@democompany.com` | `Salesman@2024!` |

> ⚠️ **Change all passwords immediately in production!**

---

## 📁 Folder Structure

```
smart-pos-erp/
├── backend/
│   ├── src/
│   │   ├── config/          # DB, Redis, Socket.IO, Cloudinary
│   │   ├── controllers/     # erp/, dev/, shared/
│   │   ├── middleware/       # auth, tenantIsolation, rbac, rateLimiter
│   │   ├── models/          # erp/, dev/, shared/ (all with companyId)
│   │   ├── queues/          # BullMQ queues + workers
│   │   ├── routes/          # erp/, dev/
│   │   ├── services/        # email, sms, stock, offline sync, backup
│   │   └── utils/           # jwt, crypto, logger, pagination
│   ├── migrations/           # migrate-mongo files
│   ├── scripts/              # seed scripts
│   └── server.js
├── frontend/
│   ├── src/
│   │   ├── apps/
│   │   │   ├── developer/   # Dev Admin Panel (dark UI)
│   │   │   └── erp/         # Company ERP Dashboard (light UI)
│   │   ├── hooks/           # useAuth, useSocket, useOffline
│   │   ├── services/        # api.js, socket.js, offline.js
│   │   ├── store/           # Redux slices: auth, cart, ui, notifications
│   │   └── styles/          # Tailwind globals
├── mobile/
│   ├── src/
│   │   ├── db/              # SQLite offline database
│   │   ├── screens/         # auth, dashboard, pos
│   │   └── services/        # api, sync
│   └── App.js
├── nginx/                    # nginx.dev.conf, nginx.prod.conf
├── docker-compose.yml        # Development
├── docker-compose.prod.yml   # Production
└── docs/
    ├── ARCHITECTURE.md
    └── API.md
```

---

## 🌍 Environment Variables

See `backend/.env.example` for all variables. Key ones:

```env
NODE_ENV=development
MONGO_URI_LOCAL=mongodb://localhost:27017/smart_pos_erp_dev
MONGO_URI_ATLAS=mongodb+srv://...         # Production only
REDIS_HOST=localhost
JWT_ACCESS_SECRET=your-64-char-secret
JWT_REFRESH_SECRET=your-64-char-secret
JWT_DEV_SECRET=your-64-char-secret
CLOUDINARY_CLOUD_NAME=your-cloud
CLOUDINARY_API_KEY=your-key
CLOUDINARY_API_SECRET=your-secret
SMTP_HOST=smtp.gmail.com
SMTP_USER=your@email.com
SMTP_PASS=your-app-password
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
ENCRYPTION_KEY=32-char-key
```

---

## 🐳 Docker Commands

```bash
# Development
docker-compose up -d                    # Start all
docker-compose logs -f backend          # Watch backend logs
docker-compose exec backend npm run migrate:up
docker-compose exec backend npm run seed:demo
docker-compose down                     # Stop all

# Production
docker-compose -f docker-compose.prod.yml up -d --build
docker-compose -f docker-compose.prod.yml logs -f
```

---

## 📱 Mobile App Setup

```bash
cd mobile
npm install
npx expo start

# Set your backend URL in .env
EXPO_PUBLIC_API_URL=http://YOUR_SERVER_IP:5000
```

---

## 🔒 Security Architecture

```
Request → Rate Limiter → Helmet/CORS
       → JWT Verify (companyId from token ONLY)
       → Tenant Isolation MW (injects tenantFilter)
       → Branch Scope MW (injects branchFilter)
       → RBAC Authorization (role + permission)
       → Resource Ownership Check (document-level)
       → Controller (always spreads tenantFilter)
       → Audit Logger (all mutations logged)
```

**Key rules:**
- `companyId` is **never** trusted from frontend — always extracted from JWT
- Every document has `companyId` — no exceptions
- All queries include `{ companyId: req.user.companyId }` — enforced by middleware
- UUIDs used for all public-facing IDs (no sequential IDs in URLs)
- Soft delete on all critical records (no permanent deletion)

---

## 📊 Database Migrations

```bash
npm run migrate:status    # Check migration status
npm run migrate:up        # Apply pending migrations
npm run migrate:down      # Roll back last migration
```

---

## 📚 API Documentation

Base URL: `http://localhost:5000`

| Prefix | Description |
|--------|-------------|
| `/api/erp/auth` | ERP authentication |
| `/api/erp/pos`  | POS operations |
| `/api/erp/products` | Product management |
| `/api/erp/customers` | Customer management |
| `/api/erp/reports` | Reports & analytics |
| `/api/dev/auth` | Dev admin authentication |
| `/api/dev/licenses` | License management |

Full API documentation: [`docs/API.md`](docs/API.md)

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit: `git commit -m 'feat: add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

MIT — See [LICENSE](LICENSE)

---

**Built for Pakistani businesses. Production-ready. Scalable to 1000+ tenants.**
