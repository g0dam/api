const { queryOne, queryAll } = require('../config/database');

class MarketMechanismService {
  static async getRankingConfig() {
    const row = await queryOne(
      `SELECT config_value FROM market_configs WHERE config_type = 'RANKING' AND config_key = 'feed_ranking'`
    );

    return {
      weights: {
        relevance: 0.35,
        priceAttractiveness: 0.2,
        sellerTrust: 0.2,
        recency: 0.15,
        engagement: 0.1,
        risk: 0.25,
        ...(row?.config_value?.weights || {})
      },
      explorationRate: row?.config_value?.explorationRate ?? 0.05
    };
  }

  static async getReferencePrice({ category }) {
    const ref = await queryOne(
      `SELECT AVG(amount)::numeric(14,2) AS avg_price,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) AS median_price,
              COUNT(*)::int AS sample_size
       FROM orders o
       JOIN listings l ON l.id = o.listing_id
       WHERE o.status = 'COMPLETED' AND ($1::text IS NULL OR l.category = $1)`,
      [category || null]
    );

    return {
      avgPrice: Number(ref?.avg_price || 0),
      medianPrice: Number(ref?.median_price || 0),
      sampleSize: Number(ref?.sample_size || 0)
    };
  }

  static async wantedMatches(wantedListingId, { limit = 20 } = {}) {
    const wanted = await queryOne('SELECT * FROM listings WHERE id = $1 AND listing_type = \'WANTED\'', [wantedListingId]);
    if (!wanted) return [];

    return queryAll(
      `SELECT l.*, p.title, p.content, a.name AS seller_name, a.trust_score, a.risk_score
       FROM listings l
       JOIN posts p ON p.id = l.post_id
       JOIN agents a ON a.id = l.seller_id
       WHERE l.listing_type = 'SELL'
         AND l.status = 'ACTIVE'
         AND ($1::text IS NULL OR l.category = $1)
         AND l.price_listed <= COALESCE($2, l.price_listed)
       ORDER BY (a.trust_score - a.risk_score * 0.5) DESC, l.price_listed ASC
       LIMIT $3`,
      [wanted.category || null, wanted.price_listed || null, limit]
    );
  }
}

module.exports = MarketMechanismService;
