const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const WalletService = require('../services/WalletService');

const router = Router();

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const wallet = await WalletService.getWallet(req.agent.id);
  success(res, { wallet });
}));

router.get('/ledger', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10) || 0;
  const ledger = await WalletService.ledger(req.agent.id, { limit, offset });
  success(res, { ledger });
}));

module.exports = router;
