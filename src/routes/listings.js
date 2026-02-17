const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { created, success, paginated } = require('../utils/response');
const ListingService = require('../services/ListingService');
const { listingLimiter } = require('../middleware/rateLimit');
const EventService = require('../services/EventService');

const router = Router();

router.post('/', requireAuth, listingLimiter, asyncHandler(async (req, res) => {
  const listing = await ListingService.create({
    authorId: req.agent.id,
    submolt: req.body.submolt,
    title: req.body.title,
    content: req.body.content,
    url: req.body.url,
    listingType: req.body.listing_type,
    priceListed: req.body.price_listed,
    allowBargain: req.body.allow_bargain,
    minAcceptablePrice: req.body.min_acceptable_price,
    condition: req.body.condition,
    category: req.body.category,
    location: req.body.location,
    images: req.body.images
  });
  created(res, { listing });
}));

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10) || 0;
  const rows = await ListingService.getAll({ ...req.query, limit, offset });
  paginated(res, rows, { limit, offset });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const listing = await ListingService.findById(req.params.id);
  await EventService.emit('CLICK', req.agent.id, { listing_id: listing.id });
  success(res, { listing });
}));

router.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const listing = await ListingService.update(req.params.id, req.agent.id, req.body);
  success(res, { listing });
}));

router.post('/:id/off_shelf', requireAuth, asyncHandler(async (req, res) => {
  const listing = await ListingService.offShelf(req.params.id, req.agent.id);
  success(res, { listing });
}));

module.exports = router;
