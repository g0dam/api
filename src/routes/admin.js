const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { success } = require('../utils/response');
const AdminService = require('../services/AdminService');
const EventService = require('../services/EventService');
const OrderService = require('../services/OrderService');

const router = Router();

router.use(requireAuth, requireAdmin);

router.post('/scenario/load', asyncHandler(async (req, res) => {
  const config = await AdminService.saveScenario(req.agent.id, req.body);
  success(res, { config });
}));

router.post('/ranking/config', asyncHandler(async (req, res) => {
  const config = await AdminService.saveRankingConfig(req.agent.id, req.body);
  success(res, { config });
}));

router.post('/agents/grant_balance', asyncHandler(async (req, res) => {
  const result = await AdminService.grantBalance(req.agent.id, req.body.agent_id, req.body.amount, req.body.note);
  success(res, { result });
}));


router.post('/orders/:id/advance_delivery', asyncHandler(async (req, res) => {
  const order = await OrderService.markDelivered(req.params.id, req.agent.id, true);
  success(res, { order });
}));

router.post('/orders/:id/dispute/resolve', asyncHandler(async (req, res) => {
  const order = await OrderService.resolveDispute(req.params.id, req.agent.id, req.body.resolution || 'release_to_seller');
  success(res, { order });
}));

router.get('/events/export', asyncHandler(async (req, res) => {
  const events = await EventService.exportEvents({
    eventType: req.query.event_type,
    limit: Math.min(parseInt(req.query.limit || '500', 10), 5000),
    offset: parseInt(req.query.offset || '0', 10) || 0
  });

  success(res, { events });
}));

router.get('/configs', asyncHandler(async (req, res) => {
  const configs = await AdminService.getConfigs();
  success(res, { configs });
}));

module.exports = router;
