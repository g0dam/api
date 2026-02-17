const { queryOne, queryAll } = require('../config/database');
const { BadRequestError } = require('../utils/errors');
const EventService = require('./EventService');

class AdminService {
  static async saveScenario(adminId, scenario) {
    if (!scenario || typeof scenario !== 'object') throw new BadRequestError('scenario payload is required');

    const result = await queryOne(
      `INSERT INTO market_configs (config_type, config_key, config_value, updated_by_agent_id)
       VALUES ('SCENARIO', 'active_scenario', $1::jsonb, $2)
       ON CONFLICT (config_type, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_by_agent_id = EXCLUDED.updated_by_agent_id, updated_at = NOW()
       RETURNING *`,
      [JSON.stringify(scenario), adminId]
    );

    await EventService.emit('SCENARIO_LOADED', adminId, { config_id: result.id });
    return result;
  }

  static async saveRankingConfig(adminId, rankingConfig) {
    const result = await queryOne(
      `INSERT INTO market_configs (config_type, config_key, config_value, updated_by_agent_id)
       VALUES ('RANKING', 'feed_ranking', $1::jsonb, $2)
       ON CONFLICT (config_type, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_by_agent_id = EXCLUDED.updated_by_agent_id, updated_at = NOW()
       RETURNING *`,
      [JSON.stringify(rankingConfig || {}), adminId]
    );

    await EventService.emit('RANKING_CONFIG_UPDATED', adminId, { config_id: result.id });
    return result;
  }

  static async grantBalance(adminId, targetAgentId, amount, note = 'Admin grant') {
    if (Number(amount) <= 0) throw new BadRequestError('amount must be > 0');

    const result = await queryOne(
      `UPDATE agents SET wallet_balance = wallet_balance + $2, updated_at = NOW() WHERE id = $1 RETURNING id, wallet_balance`,
      [targetAgentId, Number(amount)]
    );

    await queryOne(
      `INSERT INTO wallet_ledger (agent_id, entry_type, amount, balance_after, note)
       VALUES ($1, 'ADMIN_GRANT', $2, $3, $4) RETURNING id`,
      [targetAgentId, Number(amount), Number(result.wallet_balance), note]
    );

    await EventService.emit('BALANCE_GRANTED', adminId, { target_agent_id: targetAgentId, amount: Number(amount) });
    return result;
  }

  static async getConfigs() {
    return queryAll(
      `SELECT id, config_type, config_key, config_value, updated_by_agent_id, updated_at
       FROM market_configs ORDER BY updated_at DESC`
    );
  }
}

module.exports = AdminService;
