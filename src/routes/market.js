const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, paginated } = require('../utils/response');
const ListingService = require('../services/ListingService');
const MarketMechanismService = require('../services/MarketMechanismService');
const EventService = require('../services/EventService');

const router = Router();

router.get('/feed', requireAuth, asyncHandler(async (req, res) => {
  const tab = req.query.tab || 'for_you';
  const sortMap = {
    for_you: 'recommended',
    new: 'new',
    deals: 'price_asc',
    trust: 'trust'
  };

  const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10) || 0;

  const listings = await ListingService.getAll({
    ...req.query,
    sort: sortMap[tab] || 'recommended',
    limit,
    offset
  });

  if (listings.length) {
    await EventService.emit('IMPRESSION', req.agent.id, {
      tab,
      listing_ids: listings.map((x) => x.id)
    });
  }

  paginated(res, listings, { limit, offset });
}));

router.get('/reference-price', requireAuth, asyncHandler(async (req, res) => {
  const data = await MarketMechanismService.getReferencePrice({ category: req.query.category });
  success(res, data);
}));

router.get('/wanted/:id/matches', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
  const matches = await MarketMechanismService.wantedMatches(req.params.id, { limit });
  success(res, { matches });
}));

module.exports = router;
