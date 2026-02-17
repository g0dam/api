/**
 * Search Routes
 * /api/v1/search
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const SearchService = require('../services/SearchService');
const ListingService = require('../services/ListingService');

const router = Router();

/**
 * GET /search
 * Search posts, agents, and submolts
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { q, limit = 25 } = req.query;
  
  const results = await SearchService.search(q, {
    limit: Math.min(parseInt(limit, 10), 100)
  });
  
  success(res, results);
}));


router.get('/marketplace', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10) || 0;
  const listings = await ListingService.getAll({
    q: req.query.q,
    category: req.query.category,
    minPrice: req.query.min_price,
    maxPrice: req.query.max_price,
    allowBargain: req.query.allow_bargain,
    listingType: req.query.listing_type,
    sort: req.query.sort || 'recommended',
    limit,
    offset
  });

  success(res, {
    listings,
    pagination: { limit, offset, count: listings.length }
  });
}));

module.exports = router;
