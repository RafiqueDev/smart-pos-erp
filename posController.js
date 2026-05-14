'use strict';

const mongoose   = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Sale       = require('../models/erp/Sale');
const Product    = require('../models/erp/Product');
const { Customer }  = require('../models/erp/Customer');
const { Settings }  = require('../models/erp/Purchase');
const stockService  = require('../services/stockService');
const { ApiResponse, ApiError, PaginatedResponse } = require('../utils/ApiResponse');
const { parsePagination, paginateQuery } = require('../utils/pagination');
const { emitToCompany, emitDashboardUpdate } = require('../config/socket');
const { cacheGet, cacheSet, cacheDel, cacheDelPattern } = require('../config/redis');
const { addEmailJob, addSMSJob, addSyncJob } = require('../queues');
const logger = require('../utils/logger');

// ─── Helper: Generate Invoice Number ─────────────────────────────────────────
async function generateInvoiceNumber(companyId, session) {
  const { Settings: S } = require('../models/erp/Purchase');
  const settings = await S.findOneAndUpdate(
    { companyId },
    { $inc: { invoiceCounter: 1 } },
    { new: true, session, upsert: true }
  ).lean();
  const prefix  = settings?.invoicePrefix || 'INV';
  const counter = String(settings?.invoiceCounter || 1).padStart(6, '0');
  const year    = new Date().getFullYear();
  return `${prefix}-${year}-${counter}`;
}

// ─── Create Sale ──────────────────────────────────────────────────────────────
async function createSale(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { companyId, branchId, userId } = req.user;
    const {
      items, customerId, customerName, customerPhone,
      paymentMethod, payments, amountPaid, changeAmount,
      discountTotal = 0, notes, warehouseId,
    } = req.body;

    if (!items?.length) throw ApiError.badRequest('No items in sale');

    // ── Load settings ───────────────────────────────────────────────────────
    const settings = await Settings.findOne({ companyId }).lean();

    // ── Validate & price items server-side (NEVER trust client prices) ──────
    let subtotal = 0, taxTotal = 0, totalCost = 0;
    const verifiedItems = [];

    for (const item of items) {
      const product = await Product.findOne({
        _id: item.productId, companyId, isDeleted: false, status: 'active',
      }).session(session).lean();

      if (!product) throw ApiError.badRequest(`Product not found: ${item.productId}`);
      if (item.quantity <= 0) throw ApiError.badRequest(`Invalid quantity for: ${product.name}`);

      // Check stock (unless negative stock is allowed)
      if (!settings?.negativeStock && product.quantity < item.quantity) {
        throw ApiError.badRequest(
          `Insufficient stock for "${product.name}". Available: ${product.quantity}, Requested: ${item.quantity}`
        );
      }

      // Price resolution: use product.salePrice if set, else use item.salePrice (cashier entered)
      const salePrice   = product.salePrice != null ? product.salePrice : (item.salePrice || 0);
      const costPrice   = product.costPrice || 0;

      // Min price check
      if (product.minSalePrice && salePrice < product.minSalePrice) {
        throw ApiError.badRequest(`Sale price for "${product.name}" is below minimum allowed`);
      }

      const discount    = Math.max(0, item.discount || 0);
      const taxRate     = product.taxRate || settings?.taxRate || 0;
      const lineSubtotal = (salePrice * item.quantity) - discount;
      const taxAmount   = settings?.taxInclusive ? 0 : lineSubtotal * (taxRate / 100);
      const lineTotal   = lineSubtotal + taxAmount;

      subtotal  += lineSubtotal;
      taxTotal  += taxAmount;
      totalCost += costPrice * item.quantity;

      verifiedItems.push({
        productId:   product._id,
        productName: product.name,
        sku:         product.sku,
        barcode:     product.barcode,
        unit:        product.unit,
        quantity:    item.quantity,
        costPrice,
        salePrice,
        discount,
        discountPct: item.discountPct || 0,
        taxRate,
        taxAmount,
        subtotal:    lineSubtotal,
        total:       lineTotal,
        profit:      (salePrice - costPrice) * item.quantity - discount,
      });
    }

    const grandTotal  = subtotal + taxTotal - (discountTotal || 0);
    const grossProfit = grandTotal - totalCost;
    const paid        = amountPaid || grandTotal;
    const amountDue   = Math.max(0, grandTotal - paid);

    // ── Validate customer if credit sale ───────────────────────────────────
    if (customerId) {
      const customer = await Customer.findOne({ _id: customerId, companyId, isDeleted: false })
        .session(session).lean();
      if (!customer) throw ApiError.badRequest('Customer not found');
      if (paymentMethod === 'credit' && customer.creditLimit > 0) {
        if ((customer.currentBalance + amountDue) > customer.creditLimit) {
          throw ApiError.badRequest(`Customer credit limit exceeded. Limit: ${customer.creditLimit}`);
        }
      }
    }

    // ── Generate invoice number ────────────────────────────────────────────
    const invoiceNumber = await generateInvoiceNumber(companyId, session);

    // ── Create sale ───────────────────────────────────────────────────────
    const [sale] = await Sale.create([{
      companyId, branchId, warehouseId,
      invoiceNumber,
      customerId:    customerId || null,
      customerName:  customerName || 'Walk-in Customer',
      customerPhone: customerPhone || null,
      salesmanId:    userId,
      salesmanName:  req.user.name,
      items:         verifiedItems,
      subtotal,
      discountTotal: discountTotal || 0,
      taxTotal,
      grandTotal,
      totalCost,
      grossProfit,
      paymentMethod,
      payments:      payments || [{ method: paymentMethod, amount: paid }],
      amountPaid:    paid,
      amountDue,
      changeAmount:  changeAmount || 0,
      status:        'completed',
      notes,
    }], { session });

    // ── Deduct stock ───────────────────────────────────────────────────────
    await stockService.deductSaleStock(
      verifiedItems,
      { companyId, branchId, warehouseId, saleId: sale._id, userId },
      session
    );

    // ── Update customer balance ────────────────────────────────────────────
    if (customerId && amountDue > 0) {
      await Customer.updateOne(
        { _id: customerId, companyId },
        { $inc: { currentBalance: amountDue, totalPurchases: grandTotal } },
        { session }
      );
    }

    await session.commitTransaction();

    // ── Post-commit async operations ──────────────────────────────────────
    setImmediate(async () => {
      // Real-time dashboard update
      emitToCompany(companyId, 'pos:sale-completed', {
        saleId:        sale._id,
        invoiceNumber: sale.invoiceNumber,
        grandTotal,
        paymentMethod,
        branchId,
      });
      emitDashboardUpdate(companyId, { type: 'sale', value: grandTotal });

      // Invalidate dashboard cache
      await cacheDelPattern(`dashboard:${companyId}:*`);

      // Send invoice SMS/email
      if (customerPhone && settings?.smsNotifications) {
        await addSMSJob({
          to: customerPhone, type: 'invoice',
          invoiceNumber, grandTotal,
          currency: settings?.currency || 'PKR',
          companyName: companyId,
        });
      }
    });

    return new ApiResponse(201, {
      sale: {
        id:            sale._id,
        invoiceNumber: sale.invoiceNumber,
        grandTotal:    sale.grandTotal,
        amountPaid:    sale.amountPaid,
        amountDue:     sale.amountDue,
        changeAmount:  sale.changeAmount,
        items:         verifiedItems,
        status:        sale.status,
        createdAt:     sale.createdAt,
      },
    }, 'Sale created successfully').send(res);

  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
}

// ─── Hold Invoice ─────────────────────────────────────────────────────────────
async function holdInvoice(req, res, next) {
  try {
    const { companyId, branchId, userId } = req.user;
    const { items, customerId, customerName, notes } = req.body;

    const invoiceNumber = `HOLD-${Date.now()}`;
    const [sale] = await Sale.create([{
      companyId, branchId,
      invoiceNumber,
      customerId:   customerId || null,
      customerName: customerName || 'Walk-in',
      salesmanId:   userId,
      items:        items || [],
      subtotal:     0, grandTotal: 0, totalCost: 0, grossProfit: 0,
      paymentMethod:'cash', amountPaid: 0,
      status:       'held',
      notes,
    }]);

    emitToCompany(companyId, 'pos:invoice-held', { saleId: sale._id, invoiceNumber });

    return new ApiResponse(201, { saleId: sale._id, invoiceNumber }, 'Invoice held').send(res);
  } catch (err) {
    next(err);
  }
}

// ─── Get Held Invoices ────────────────────────────────────────────────────────
async function getHeldInvoices(req, res, next) {
  try {
    const { companyId, branchId, userId, role } = req.user;
    const filter = {
      ...req.tenantFilter,
      ...req.branchFilter,
      status: 'held',
      ...(role === 'salesman' && { salesmanId: userId }),
    };

    const sales = await Sale.find(filter)
      .select('invoiceNumber customerName items status createdAt salesmanId')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return new ApiResponse(200, { sales }).send(res);
  } catch (err) {
    next(err);
  }
}

// ─── Process Return/Refund ────────────────────────────────────────────────────
async function processReturn(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { companyId, branchId, userId } = req.user;
    const { originalSaleId, items, reason } = req.body;

    const originalSale = await Sale.findOne({
      _id: originalSaleId, companyId, isDeleted: false,
      status: { $in: ['completed', 'partially_returned'] },
    }).session(session);

    if (!originalSale) throw ApiError.notFound('Original sale');

    // Validate return items
    let returnTotal = 0;
    const returnItems = [];

    for (const rItem of items) {
      const origItem = originalSale.items.find(i => i.productId === rItem.productId);
      if (!origItem) throw ApiError.badRequest(`Item not in original sale: ${rItem.productId}`);

      const maxReturn = origItem.quantity - (origItem.returnedQty || 0);
      if (rItem.quantity > maxReturn) {
        throw ApiError.badRequest(`Cannot return ${rItem.quantity} of ${origItem.productName}. Max: ${maxReturn}`);
      }

      returnTotal += rItem.quantity * origItem.salePrice;
      returnItems.push({ ...origItem, quantity: rItem.quantity, returnedQty: rItem.quantity });
    }

    // Create return invoice
    const returnInvoiceNumber = `RET-${originalSale.invoiceNumber}`;
    const [returnSale] = await Sale.create([{
      companyId, branchId,
      invoiceNumber:  returnInvoiceNumber,
      customerId:     originalSale.customerId,
      customerName:   originalSale.customerName,
      salesmanId:     userId,
      items:          returnItems,
      subtotal:       returnTotal,
      grandTotal:     returnTotal,
      totalCost:      0, grossProfit: 0,
      paymentMethod:  originalSale.paymentMethod,
      amountPaid:     returnTotal,
      status:         'returned',
      isReturn:       true,
      originalSaleId: originalSale._id,
      notes:          reason,
    }], { session });

    // Restore stock
    await stockService.restoreReturnStock(
      returnItems,
      { companyId, branchId, saleId: returnSale._id, userId },
      session
    );

    // Update original sale status
    const allReturned = originalSale.items.every(i => {
      const ret = returnItems.find(r => r.productId === i.productId);
      return ret ? (i.returnedQty || 0) + ret.quantity >= i.quantity : false;
    });

    await Sale.updateOne(
      { _id: originalSaleId },
      {
        $set:  { status: allReturned ? 'returned' : 'partially_returned' },
        $inc:  { returnedAmount: returnTotal },
      },
      { session }
    );

    await session.commitTransaction();

    emitToCompany(companyId, 'pos:return-processed', {
      returnSaleId: returnSale._id, originalSaleId, returnTotal,
    });
    await cacheDelPattern(`dashboard:${companyId}:*`);

    return new ApiResponse(201, { returnSaleId: returnSale._id, returnTotal }, 'Return processed').send(res);
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
}

// ─── Get Invoice by ID ────────────────────────────────────────────────────────
async function getInvoice(req, res, next) {
  try {
    const sale = await Sale.findOne({ _id: req.params.id, ...req.tenantFilter })
      .populate('customerId',  'name phone email')
      .populate('salesmanId',  'name')
      .lean();

    if (!sale) return next(ApiError.notFound('Invoice'));
    return new ApiResponse(200, { sale }).send(res);
  } catch (err) {
    next(err);
  }
}

// ─── List Invoices ────────────────────────────────────────────────────────────
async function listInvoices(req, res, next) {
  try {
    const { page, limit, sort } = parsePagination(req.query);
    const { status, paymentMethod, from, to, search } = req.query;

    const filter = {
      ...req.tenantFilter,
      ...req.branchFilter,
      ...(status && { status }),
      ...(paymentMethod && { paymentMethod }),
      ...(from || to) && {
        invoiceDate: {
          ...(from && { $gte: new Date(from) }),
          ...(to   && { $lte: new Date(to) }),
        },
      },
      ...(search && {
        $or: [
          { invoiceNumber: { $regex: search, $options: 'i' } },
          { customerName:  { $regex: search, $options: 'i' } },
          { customerPhone: { $regex: search, $options: 'i' } },
        ],
      }),
    };

    const result = await paginateQuery(Sale, filter, {
      page, limit, sort,
      select:   'invoiceNumber customerName grandTotal paymentMethod status amountPaid amountDue createdAt',
    });

    return new PaginatedResponse(result.data, result.pagination).send(res);
  } catch (err) {
    next(err);
  }
}

// ─── POS Product Search (optimized for speed) ─────────────────────────────────
async function searchProducts(req, res, next) {
  try {
    const { q, categoryId, page = 1, limit = 30 } = req.query;
    const { companyId } = req.user;

    const cacheKey = `pos-search:${companyId}:${q || ''}:${categoryId || ''}:${page}`;
    const cached   = await cacheGet(cacheKey);
    if (cached) return new ApiResponse(200, cached).send(res);

    const filter = {
      companyId,
      isDeleted: false,
      status:    'active',
      ...(categoryId && { categoryId }),
      ...(q && {
        $or: [
          { name:    { $regex: q, $options: 'i' } },
          { sku:     { $regex: q, $options: 'i' } },
          { barcode: { $regex: q, $options: 'i' } },
        ],
      }),
    };

    const products = await Product.find(filter)
      .select('name sku barcode salePrice costPrice quantity unit thumbnail taxRate category')
      .populate('categoryId', 'name')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    const data = { products };
    await cacheSet(cacheKey, data, 30); // 30s cache for POS search
    return new ApiResponse(200, data).send(res);
  } catch (err) {
    next(err);
  }
}

// ─── Offline Sync ─────────────────────────────────────────────────────────────
async function syncOffline(req, res, next) {
  try {
    const { transactions } = req.body;
    if (!transactions?.length) return new ApiResponse(200, { processed: 0 }, 'Nothing to sync').send(res);

    const { addSyncJob } = require('../../queues');
    const job = await addSyncJob({
      transactions,
      userId:      req.user.userId,
      companyId:   req.user.companyId,
      branchId:    req.user.branchId,
      warehouseId: req.body.warehouseId,
    });

    return new ApiResponse(202, { jobId: job.id, count: transactions.length }, 'Sync queued').send(res);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSale,
  holdInvoice,
  getHeldInvoices,
  processReturn,
  getInvoice,
  listInvoices,
  searchProducts,
  syncOffline,
};
