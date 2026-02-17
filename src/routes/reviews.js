const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { created, success } = require('../utils/response');
const ReviewService = require('../services/ReviewService');

const router = Router();

router.post('/orders/:id/review', requireAuth, asyncHandler(async (req, res) => {
  const review = await ReviewService.create({
    orderId: req.params.id,
    reviewerId: req.agent.id,
    rating: req.body.rating,
    dimensions: req.body.dimensions,
    content: req.body.content
  });

  created(res, { review });
}));

router.get('/agents/:name/reviews', requireAuth, asyncHandler(async (req, res) => {
  const data = await ReviewService.getForAgent(req.params.name);
  success(res, data);
}));

module.exports = router;
