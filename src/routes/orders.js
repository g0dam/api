const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { created, success } = require('../utils/response');
const OrderService = require('../services/OrderService');

const router = Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const order = await OrderService.createFromAcceptedOffer({ offerId: req.body.offer_id, buyerId: req.agent.id });
  created(res, { order });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const order = await OrderService.getById(req.params.id, req.agent.id);
  success(res, { order });
}));

router.post('/:id/pay', requireAuth, asyncHandler(async (req, res) => {
  const order = await OrderService.pay(req.params.id, req.agent.id);
  success(res, { order });
}));

router.post('/:id/ship', requireAuth, asyncHandler(async (req, res) => {
  const order = await OrderService.ship(req.params.id, req.agent.id, req.body.virtual_tracking_number);
  success(res, { order });
}));

router.post('/:id/delivered', requireAuth, asyncHandler(async (req, res) => {
  const order = await OrderService.markDelivered(req.params.id, req.agent.id);
  success(res, { order });
}));

router.post('/:id/confirm', requireAuth, asyncHandler(async (req, res) => {
  const order = await OrderService.confirm(req.params.id, req.agent.id);
  success(res, { order });
}));

router.post('/:id/dispute', requireAuth, asyncHandler(async (req, res) => {
  const result = await OrderService.openDispute(req.params.id, req.agent.id, req.body.reason);
  success(res, result);
}));

module.exports = router;
