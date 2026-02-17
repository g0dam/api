const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const EventService = require('./EventService');

class ReviewService {
  static async create({ orderId, reviewerId, rating, dimensions = {}, content = '' }) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BadRequestError('rating must be integer 1-5');

    const order = await queryOne('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (!order) throw new NotFoundError('Order');
    if (order.status !== 'COMPLETED') throw new ConflictError('Reviews allowed only after completed orders');
    if (![order.buyer_agent_id, order.seller_agent_id].includes(reviewerId)) throw new ForbiddenError('No access to this order');

    const reviewedAgentId = reviewerId === order.buyer_agent_id ? order.seller_agent_id : order.buyer_agent_id;

    const existing = await queryOne('SELECT id FROM reviews WHERE order_id = $1 AND reviewer_agent_id = $2', [orderId, reviewerId]);
    if (existing) throw new ConflictError('You already reviewed this order');

    const review = await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO reviews (order_id, listing_id, reviewer_agent_id, reviewed_agent_id, rating, dimensions, content)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING *`,
        [orderId, order.listing_id, reviewerId, reviewedAgentId, rating, JSON.stringify(dimensions || {}), content || null]
      );

      await client.query(
        `WITH metrics AS (
          SELECT
            (SELECT COALESCE(AVG(rating)::numeric(3,2), 0) FROM reviews WHERE reviewed_agent_id = $1) AS avg_rating,
            (SELECT COALESCE(AVG(CASE WHEN status = 'DISPUTED' THEN 1 ELSE 0 END), 0)
             FROM orders WHERE seller_agent_id = $1 OR buyer_agent_id = $1) AS dispute_rate,
            (SELECT COALESCE(AVG(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0)
             FROM orders WHERE seller_agent_id = $1 OR buyer_agent_id = $1) AS completion_rate
        )
        UPDATE agents a
        SET avg_rating = m.avg_rating,
            dispute_rate = m.dispute_rate,
            completion_rate = m.completion_rate,
            trust_score = GREATEST(0, LEAST(100, (m.avg_rating * 18) + (m.completion_rate * 20) - (m.dispute_rate * 30))),
            risk_score = GREATEST(0, LEAST(100, (m.dispute_rate * 100) - (m.completion_rate * 20)))
        FROM metrics m
        WHERE a.id = $1`,
        [reviewedAgentId]
      );

      return result.rows[0];
    });

    await EventService.emit('REVIEW_CREATED', reviewerId, { review_id: review.id, order_id: orderId, rating });
    return review;
  }

  static async getForAgent(agentName) {
    const agent = await queryOne('SELECT id, name, display_name FROM agents WHERE name = $1', [agentName.toLowerCase().trim()]);
    if (!agent) throw new NotFoundError('Agent');

    const reviews = await queryAll(
      `SELECT r.*, reviewer.name AS reviewer_name, reviewer.display_name AS reviewer_display_name
       FROM reviews r
       JOIN agents reviewer ON reviewer.id = r.reviewer_agent_id
       WHERE r.reviewed_agent_id = $1
       ORDER BY r.created_at DESC`,
      [agent.id]
    );

    return { agent, reviews };
  }
}

module.exports = ReviewService;
