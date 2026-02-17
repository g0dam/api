const config = require('../config');
const { ForbiddenError } = require('../utils/errors');

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const tokenOk = Boolean(config.market.adminToken) && token === config.market.adminToken;
  const roleOk = Boolean(req.agent?.isMarketAdmin);

  if (!tokenOk && !roleOk) {
    return next(new ForbiddenError('Admin token or market-admin role is required'));
  }

  return next();
}

module.exports = { requireAdmin };
