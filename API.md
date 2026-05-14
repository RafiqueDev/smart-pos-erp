# Smart POS ERP — API Documentation

Base URL: `http://localhost:5000/api`

All responses follow this structure:
```json
{ "success": true, "message": "...", "data": {}, "timestamp": "..." }
```

Errors:
```json
{ "success": false, "message": "...", "errors": [] }
```

---

## Authentication

All ERP endpoints require `Authorization: Bearer <accessToken>` header.
Access tokens expire in **15 minutes**. Use `/erp/auth/refresh` to renew.

---

## ERP Auth `/erp/auth`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/erp/auth/login` | ✗ | Login — returns accessToken |
| POST | `/erp/auth/refresh` | Cookie | Refresh access token |
| POST | `/erp/auth/logout` | ✓ | Logout + blacklist token |
| GET  | `/erp/auth/me` | ✓ | Get current user profile |
| PATCH| `/erp/auth/me` | ✓ | Update profile |
| POST | `/erp/auth/change-password` | ✓ | Change password |
| POST | `/erp/auth/forgot-password` | ✗ | Send OTP to email |
| POST | `/erp/auth/reset-password` | ✗ | Reset with OTP |

**Login Request:**
```json
{ "email": "admin@company.com", "password": "Admin@2024!" }
```

**Login Response:**
```json
{
  "data": {
    "accessToken": "eyJ...",
    "user":    { "id":"uuid","name":"Admin","email":"...","role":"admin","branchId":"uuid" },
    "company": { "id":"uuid","name":"Demo Store","businessType":"retail","currency":"PKR","currencySymbol":"₨" }
  }
}
```

---

## POS `/erp/pos`

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET  | `/erp/pos/search?q=&categoryId=` | all | Product search (fast) |
| POST | `/erp/pos/sale` | all | Create sale |
| POST | `/erp/pos/hold` | all | Hold invoice |
| GET  | `/erp/pos/held` | all | Get held invoices |
| POST | `/erp/pos/return` | admin,manager | Process return |
| POST | `/erp/pos/sync-offline` | all | Submit offline sales batch |
| GET  | `/erp/pos/invoices` | all | List invoices |
| GET  | `/erp/pos/invoices/:id` | all | Get invoice detail |

**Create Sale Request:**
```json
{
  "items": [
    { "productId": "uuid", "quantity": 2, "salePrice": 1200, "discount": 0 }
  ],
  "customerId": "uuid",
  "customerName": "Walk-in",
  "paymentMethod": "cash",
  "payments": [{ "method": "cash", "amount": 2400 }],
  "amountPaid": 2400,
  "changeAmount": 0
}
```

---

## Products `/erp/products`

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET    | `/erp/products?page=1&limit=20&search=&categoryId=&status=&lowStock=` | all | List products |
| GET    | `/erp/products/summary` | all | Inventory summary |
| GET    | `/erp/products/barcode/:barcode` | all | Find by barcode |
| GET    | `/erp/products/:id` | all | Get product |
| POST   | `/erp/products` | admin,manager | Create (multipart/form-data) |
| PUT    | `/erp/products/:id` | admin,manager | Update |
| DELETE | `/erp/products/:id` | admin | Soft delete |
| POST   | `/erp/products/adjust-stock` | admin,manager | Stock adjustment |

---

## Customers `/erp/customers`

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET    | `/erp/customers?page=1&search=` | all | List |
| GET    | `/erp/customers/:id` | all | Get customer |
| GET    | `/erp/customers/:id/ledger` | all | Transaction ledger |
| POST   | `/erp/customers` | all | Create |
| PUT    | `/erp/customers/:id` | admin,manager | Update |
| DELETE | `/erp/customers/:id` | admin | Soft delete |

---

## Reports `/erp/reports`

| Method | Endpoint | Role | Query Params |
|--------|----------|------|--------------|
| GET | `/erp/reports/sales` | admin,manager | `period=month&groupBy=day` |
| GET | `/erp/reports/profit` | admin | `period=month` |
| GET | `/erp/reports/inventory` | admin,manager | `categoryId=&lowStock=true` |
| GET | `/erp/reports/export` | admin,manager | `type=sales&format=pdf&period=month` |

Period values: `today`, `week`, `month`, `year`

---

## Dashboard `/erp/dashboard`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/erp/dashboard/stats` | Full dashboard stats (60s cached) |
| GET | `/erp/dashboard/daily-chart?date=2024-01-15` | Hourly breakdown |

---

## Settings `/erp/settings`

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/erp/settings` | admin,manager | Get settings |
| PUT | `/erp/settings` | admin | Update settings |

---

## Notifications `/erp/notify`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/erp/notify` | List notifications (limit=20) |
| GET    | `/erp/notify/unread-count` | Unread count |
| PATCH  | `/erp/notify/read` | Mark as read `{ "ids": ["uuid"] }` |

---

## Backup `/erp/backup`

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET    | `/erp/backup` | admin | List backups |
| POST   | `/erp/backup/create` | admin | Create manual backup |
| POST   | `/erp/backup/restore` | admin | Restore `{ "publicId": "..." }` |

---

## Sync `/erp/sync`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/erp/sync/offline` | Submit offline transaction batch |

```json
{
  "transactions": [
    {
      "offlineId": "mob-1234-abc",
      "invoiceNumber": "OFF-1234567890",
      "items": [...],
      "paymentMethod": "cash",
      "amountPaid": 2400,
      "grandTotal": 2400
    }
  ]
}
```

---

## Dev Admin `/dev`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/dev/auth/login` | Dev admin login |
| GET  | `/dev/auth/me` | Dev admin profile |
| GET  | `/dev/analytics/overview` | Platform analytics |
| GET  | `/dev/licenses` | All licenses |
| POST | `/dev/licenses/generate` | Generate activation key |
| PATCH| `/dev/licenses/:companyId/suspend` | Suspend account |

---

## Socket.IO Events

Connect: `const socket = io('http://localhost:5000', { auth: { token: accessToken } })`

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `dashboard:subscribe` | — | Subscribe to dashboard updates |
| `pos:join-terminal` | `{ terminalId }` | Join POS terminal room |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `notification:new` | `{ type, title, message, priority }` | New notification |
| `dashboard:update` | `{ type, value }` | Dashboard data changed |
| `pos:sale-completed` | `{ saleId, invoiceNumber, grandTotal }` | Sale completed |
| `stock:low` | `{ productId, name, quantity }` | Low stock alert |
| `stock:out` | `{ productId, name }` | Out of stock |
| `sync:complete` | `{ processed, skipped, failed }` | Offline sync done |

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request — validation failed |
| 401 | Unauthorized — missing/invalid/expired token |
| 403 | Forbidden — wrong role or tenant violation |
| 404 | Not Found — resource not found (or belongs to different tenant) |
| 409 | Conflict — duplicate SKU, invoice number, etc. |
| 429 | Too Many Requests — rate limit exceeded |
| 500 | Internal Server Error |

**Tenant violations return 404** (not 403) to prevent data discovery.
