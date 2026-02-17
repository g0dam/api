const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

class WalletService {
  static async getWallet(agentId) {
    const wallet = await queryOne(
      `SELECT id AS agent_id, wallet_balance, wallet_reserved
       FROM agents WHERE id = $1`,
      [agentId]
    );

    if (!wallet) throw new NotFoundError('Agent');
    return wallet;
  }

  static async ledger(agentId, { limit = 100, offset = 0 }) {
    return queryAll(
      `SELECT id, entry_type, amount, balance_after, related_order_id, related_offer_id, note, created_at
       FROM wallet_ledger
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  static async reserve(agentId, amount, note, relatedOfferId = null) {
    if (Number(amount) <= 0) throw new BadRequestError('amount must be positive');

    return transaction(async (client) => {
      const row = await client.query(
        `SELECT id, wallet_balance, wallet_reserved FROM agents WHERE id = $1 FOR UPDATE`,
        [agentId]
      );
      if (!row.rows[0]) throw new NotFoundError('Agent');

      const agent = row.rows[0];
      const available = Number(agent.wallet_balance) - Number(agent.wallet_reserved);
      if (available < Number(amount)) throw new ConflictError('Insufficient available balance');

      const updated = await client.query(
        `UPDATE agents SET wallet_reserved = wallet_reserved + $2, updated_at = NOW() WHERE id = $1 RETURNING wallet_balance, wallet_reserved`,
        [agentId, Number(amount)]
      );

      const balances = updated.rows[0];
      await client.query(
        `INSERT INTO wallet_ledger (agent_id, entry_type, amount, balance_after, related_offer_id, note)
         VALUES ($1, 'RESERVE', $2, $3, $4, $5)`,
        [agentId, Number(amount), Number(balances.wallet_balance), relatedOfferId, note]
      );

      return balances;
    });
  }

  static async settleEscrow({ buyerId, sellerId, orderId, amount, fee = 0 }) {
    return transaction(async (client) => {
      const buyer = await client.query('SELECT id, wallet_balance, wallet_reserved FROM agents WHERE id = $1 FOR UPDATE', [buyerId]);
      const seller = await client.query('SELECT id, wallet_balance, wallet_reserved FROM agents WHERE id = $1 FOR UPDATE', [sellerId]);
      if (!buyer.rows[0] || !seller.rows[0]) throw new NotFoundError('Agent');

      const netAmount = Number(amount) - Number(fee);
      await client.query(
        `UPDATE agents SET wallet_reserved = GREATEST(wallet_reserved - $2, 0), wallet_balance = wallet_balance - $2, updated_at = NOW() WHERE id = $1`,
        [buyerId, Number(amount)]
      );

      const sellerUpdated = await client.query(
        `UPDATE agents SET wallet_balance = wallet_balance + $2, updated_at = NOW() WHERE id = $1 RETURNING wallet_balance`,
        [sellerId, netAmount]
      );

      await client.query(
        `INSERT INTO wallet_ledger (agent_id, entry_type, amount, balance_after, related_order_id, note)
         VALUES ($1, 'ESCROW_DEBIT', $2, (SELECT wallet_balance FROM agents WHERE id = $1), $3, $4),
                ($5, 'SALE_CREDIT', $6, $7, $3, $8)`,
        [buyerId, Number(amount), orderId, 'Order escrow settled', sellerId, netAmount, Number(sellerUpdated.rows[0].wallet_balance), 'Order payout']
      );
    });
  }
}

module.exports = WalletService;
