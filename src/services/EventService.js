const { query } = require('../config/database');

class EventService {
  static async emit(eventType, actorAgentId = null, payload = {}, meta = {}) {
    const safePayload = payload || {};
    const safeMeta = meta || {};

    await query(
      `INSERT INTO market_events (event_type, actor_agent_id, payload, metadata)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
      [eventType, actorAgentId, JSON.stringify(safePayload), JSON.stringify(safeMeta)]
    );
  }

  static async exportEvents({ eventType, limit = 500, offset = 0 }) {
    const where = [];
    const params = [];

    if (eventType) {
      params.push(eventType);
      where.push(`event_type = $${params.length}`);
    }

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    return query(
      `SELECT id, event_type, actor_agent_id, payload, metadata, created_at
       FROM market_events
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT ${limitParam}
       OFFSET ${offsetParam}`,
      params
    ).then((result) => result.rows);
  }
}

module.exports = EventService;
