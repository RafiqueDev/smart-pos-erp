'use strict';

const { ApiError } = require('../utils/ApiResponse');
const logger = require('../utils/logger');

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           TENANT ISOLATION MIDDLEWARE  (NON-NEGOTIABLE)          ║
 * ║                                                                  ║
 * ║  This middleware runs after authenticate() on every ERP route.   ║
 * ║  It injects req.tenantFilter = { companyId, isDeleted: false }   ║
 * ║  which MUST be spread into every Mongoose query.                 ║
 * ║                                                                  ║
 * ║  Even if a developer forgets to add companyId to a query,        ║
 * ║  this middleware makes it impossible to run without the filter.  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
function tenantIsolation(req, _res, next) {
  if (!req.user?.companyId) {
    logger.error(`Tenant isolation: no companyId on req.user [${req.method} ${req.path}]`);
    return next(ApiError.forbidden('Tenant context missing'));
  }

  // Core tenant filter — spread this into EVERY query
  req.tenantFilter = {
    companyId: req.user.companyId,
    isDeleted: false,
  };

  // Convenience: companyId alone (for creates / lookups that need only companyId)
  req.companyId = req.user.companyId;

  next();
}

/**
 * Verifies that a fetched document belongs to the requesting company.
 * Call this after fetching a document but before returning it.
 *
 * @param {Object} doc        - Mongoose document or lean object
 * @param {string} companyId  - From req.user.companyId (JWT)
 * @param {string} resource   - Human-readable name for error messages
 */
function verifyOwnership(doc, companyId, resource = 'Resource') {
  if (!doc) throw ApiError.notFound(resource);

  // Convert mongoose ObjectId to string for comparison
  const docCompanyId = doc.companyId?.toString?.() || doc.companyId;

  if (docCompanyId !== companyId) {
    logger.warn(`⚠️  Ownership violation: user companyId=${companyId} attempted to access doc companyId=${docCompanyId} [${resource}]`);
    // Return 404 intentionally — don't reveal resource exists in another tenant
    throw ApiError.notFound(resource);
  }

  return doc;
}

/**
 * Middleware: verify a param ID resource belongs to the tenant.
 * Usage: router.get('/:id', authenticate, tenantIsolation, verifyResourceOwnership(Model))
 */
function verifyResourceOwnership(Model, paramName = 'id', resourceName) {
  return async (req, _res, next) => {
    try {
      const id  = req.params[paramName];
      const doc = await Model.findOne({ _id: id }).lean();

      if (!doc) return next(ApiError.notFound(resourceName || Model.modelName));

      const docCompanyId = doc.companyId?.toString?.();
      if (docCompanyId !== req.user.companyId) {
        logger.warn(
          `⚠️  Cross-tenant access attempt: user=${req.user.userId} ` +
          `companyId=${req.user.companyId} tried to access ${resourceName} companyId=${docCompanyId}`
        );
        return next(ApiError.notFound(resourceName || Model.modelName));
      }

      req.resource = doc; // Attach to request for controller use
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { tenantIsolation, verifyOwnership, verifyResourceOwnership };
