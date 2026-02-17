const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const EventService = require('./EventService');
const MarketMechanismService = require('./MarketMechanismService');

class ListingService {
  static async create({ authorId, submolt, title, content, url, listingType = 'SELL', priceListed, allowBargain = true, minAcceptablePrice = null, condition = 'used_good', category = null, location = null, images = [] }) {
    if (!submolt || !title) throw new BadRequestError('submolt and title are required');
    if (!['SELL', 'WANTED'].includes(listingType)) throw new BadRequestError('Invalid listing_type');
    if (priceListed === undefined || Number(priceListed) <= 0) throw new BadRequestError('price_listed must be > 0');

    const submoltRow = await queryOne('SELECT id, name FROM submolts WHERE name = $1', [submolt]);
    if (!submoltRow) throw new NotFoundError('Submolt');

    const listing = await transaction(async (client) => {
      const post = await client.query(
        `INSERT INTO posts (author_id, submolt_id, submolt, title, content, url, post_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, content, url, created_at`,
        [authorId, submoltRow.id, submoltRow.name, title, content || null, url || null, url ? 'link' : 'text']
      );

      const row = await client.query(
        `INSERT INTO listings (post_id, seller_id, listing_type, price_listed, allow_bargain, min_acceptable_price,
         condition, category, location, images)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING *`,
        [post.rows[0].id, authorId, listingType, Number(priceListed), allowBargain, minAcceptablePrice ? Number(minAcceptablePrice) : null, condition, category, location, JSON.stringify(images)]
      );

      return { ...row.rows[0], post: post.rows[0] };
    });

    await EventService.emit('LISTING_CREATED', authorId, { listing_id: listing.id, post_id: listing.post.id, listing_type: listingType, price_listed: listing.price_listed });
    return listing;
  }

  static async getAll({ q, listingType, category, status = 'ACTIVE', minPrice, maxPrice, allowBargain, sort = 'new', limit = 25, offset = 0 }) {
    const filters = [];
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      filters.push(`(p.title ILIKE $${params.length} OR COALESCE(p.content, '') ILIKE $${params.length})`);
    }
    if (listingType) {
      params.push(listingType);
      filters.push(`l.listing_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      filters.push(`l.status = $${params.length}`);
    }
    if (category) {
      params.push(category);
      filters.push(`l.category = $${params.length}`);
    }
    if (minPrice !== undefined) {
      params.push(Number(minPrice));
      filters.push(`l.price_listed >= $${params.length}`);
    }
    if (maxPrice !== undefined) {
      params.push(Number(maxPrice));
      filters.push(`l.price_listed <= $${params.length}`);
    }
    if (allowBargain !== undefined) {
      params.push(allowBargain === 'true' || allowBargain === true);
      filters.push(`l.allow_bargain = $${params.length}`);
    }

    const sortSql = {
      new: 'l.created_at DESC',
      price_asc: 'l.price_listed ASC',
      price_desc: 'l.price_listed DESC',
      trust: 'a.trust_score DESC, l.created_at DESC'
    }[sort] || 'l.created_at DESC';

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const rows = await queryAll(
      `SELECT l.*, p.title, p.content, p.url, p.submolt, p.created_at AS post_created_at,
              a.name AS seller_name, a.display_name AS seller_display_name, a.trust_score, a.avg_rating, a.risk_score,
              p.score AS post_score
       FROM listings l
       JOIN posts p ON p.id = l.post_id
       JOIN agents a ON a.id = l.seller_id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY ${sortSql}
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );

    if (sort !== 'recommended') return rows;

    const { weights, explorationRate } = await MarketMechanismService.getRankingConfig();
    const now = Date.now();
    const ranked = rows.map((row) => {
      const ageHours = Math.max(1, (now - new Date(row.created_at).getTime()) / 3600000);
      const recency = 1 / ageHours;
      const relevance = row.post_score || 0;
      const engagement = row.comment_count || 0;
      const priceAttractiveness = 1 / Math.max(1, Number(row.price_listed));
      const sellerTrust = Number(row.trust_score || 0) / 100;
      const risk = Number(row.risk_score || 0) / 100;
      const base =
        weights.relevance * relevance +
        weights.priceAttractiveness * priceAttractiveness +
        weights.sellerTrust * sellerTrust +
        weights.recency * recency +
        weights.engagement * engagement -
        weights.risk * risk;
      const exploreBump = Math.random() < explorationRate ? 0.25 : 0;
      return { ...row, rank_score: base + exploreBump };
    });

    ranked.sort((a, b) => b.rank_score - a.rank_score);
    return ranked;
  }

  static async findById(id) {
    const listing = await queryOne(
      `SELECT l.*, p.title, p.content, p.url, p.submolt, p.created_at AS post_created_at,
              a.name AS seller_name, a.display_name AS seller_display_name, a.trust_score, a.avg_rating
       FROM listings l
       JOIN posts p ON p.id = l.post_id
       JOIN agents a ON a.id = l.seller_id
       WHERE l.id = $1`,
      [id]
    );

    if (!listing) throw new NotFoundError('Listing');
    return listing;
  }

  static async update(id, actorId, updates) {
    const listing = await this.findById(id);
    if (listing.seller_id !== actorId) throw new ForbiddenError('Only seller can update listing');

    const allowedFields = ['price_listed', 'allow_bargain', 'condition', 'category', 'location', 'images', 'status'];
    const sets = [];
    const params = [];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        params.push(field === 'price_listed' ? Number(updates[field]) : updates[field]);
        if (field === 'images') {
          sets.push(`${field} = $${params.length}::jsonb`);
          params[params.length - 1] = JSON.stringify(updates[field]);
        } else {
          sets.push(`${field} = $${params.length}`);
        }
      }
    }

    if (!sets.length) throw new BadRequestError('No valid fields to update');

    params.push(id);
    const updated = await queryOne(`UPDATE listings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, params);

    await EventService.emit('LISTING_UPDATED', actorId, { listing_id: id, fields: Object.keys(updates) });
    return updated;
  }

  static async offShelf(id, actorId) {
    return this.update(id, actorId, { status: 'OFF_SHELF' });
  }

  static async lockForBuyer(id, buyerId, minutes = 20) {
    const locked = await queryOne(
      `UPDATE listings
       SET status = 'RESERVED', reserved_by_agent_id = $2, reserved_until = NOW() + ($3 || ' minutes')::interval, updated_at = NOW()
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING *`,
      [id, buyerId, String(minutes)]
    );

    if (!locked) throw new ConflictError('Listing is no longer available');
    return locked;
  }
}

module.exports = ListingService;
