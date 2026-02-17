const { queryOne, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const WalletService = require('./WalletService');
const EventService = require('./EventService');

class OrderService {
  static async createFromAcceptedOffer({ offerId, buyerId }) {
    const offer = await queryOne('SELECT * FROM offers WHERE id = $1', [offerId]);
    if (!offer) throw new NotFoundError('Offer');
    if (offer.status !== 'ACCEPTED') throw new ConflictError('Offer must be ACCEPTED to create order');

    const convo = await queryOne('SELECT * FROM conversations WHERE id = $1', [offer.conversation_id]);
    if (!convo) throw new NotFoundError('Conversation');
    if (convo.buyer_agent_id !== buyerId) throw new ForbiddenError('Only buyer can create order');

    const existing = await queryOne('SELECT id FROM orders WHERE offer_id = $1', [offerId]);
    if (existing) throw new ConflictError('Order already exists for this offer');

    const order = await queryOne(
      `INSERT INTO orders (listing_id, conversation_id, offer_id, buyer_agent_id, seller_agent_id, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'OFFER_ACCEPTED')
       RETURNING *`,
      [offer.listing_id, offer.conversation_id, offer.id, convo.buyer_agent_id, convo.seller_agent_id, Number(offer.price)]
    );

    await EventService.emit('ORDER_CREATED', buyerId, { order_id: order.id, offer_id: offer.id, amount: Number(offer.price) });
    return order;
  }

  static async getById(orderId, actorId = null) {
    const order = await queryOne('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (!order) throw new NotFoundError('Order');
    if (actorId && ![order.buyer_agent_id, order.seller_agent_id].includes(actorId)) throw new ForbiddenError('No access to this order');
    return order;
  }

  static async pay(orderId, buyerId) {
    const order = await this.getById(orderId, buyerId);
    if (order.buyer_agent_id !== buyerId) throw new ForbiddenError('Only buyer can pay order');
    if (order.status !== 'OFFER_ACCEPTED') throw new ConflictError('Order must be OFFER_ACCEPTED before payment');

    const wallet = await WalletService.getWallet(buyerId);
    const available = Number(wallet.wallet_balance) - Number(wallet.wallet_reserved);
    if (available < Number(order.amount)) throw new ConflictError('Insufficient balance');

    await WalletService.reserve(buyerId, Number(order.amount), 'Reserve for order payment', order.offer_id);
    const updated = await queryOne(
      `UPDATE orders SET status = 'PAID_IN_ESCROW', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [orderId]
    );

    await EventService.emit('ORDER_PAID', buyerId, { order_id: orderId, amount: Number(order.amount) });
    return updated;
  }

  static async ship(orderId, sellerId) {
    const order = await this.getById(orderId, sellerId);
    if (order.seller_agent_id !== sellerId) throw new ForbiddenError('Only seller can ship this order');
    if (order.status !== 'PAID_IN_ESCROW') throw new ConflictError('Order must be PAID_IN_ESCROW before shipping');

    const updated = await queryOne(
      `UPDATE orders SET status = 'SHIPPED', shipped_at = NOW(), virtual_tracking_number = COALESCE($2, virtual_tracking_number), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [orderId, `virtual-${orderId.slice(0, 8)}-${Date.now()}`]
    );

    await EventService.emit('ORDER_SHIPPED', sellerId, { order_id: orderId });
    return updated;
  }

  static async markDelivered(orderId, actorId = null, force = false) {
    const order = await this.getById(orderId, force ? null : actorId);
    if (!force && actorId && ![order.seller_agent_id, order.buyer_agent_id].includes(actorId)) {
      throw new ForbiddenError('No access to this order');
    }
    if (!['SHIPPED', 'PAID_IN_ESCROW'].includes(order.status)) throw new ConflictError('Order cannot be delivered from current state');

    const updated = await queryOne(
      `UPDATE orders SET status = 'DELIVERED', delivered_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [orderId]
    );

    await EventService.emit('ORDER_DELIVERED', actorId, { order_id: orderId, forced: force });
    return updated;
  }

  static async confirm(orderId, buyerId) {
    const order = await this.getById(orderId, buyerId);
    if (order.buyer_agent_id !== buyerId) throw new ForbiddenError('Only buyer can confirm order');
    if (!['SHIPPED', 'DELIVERED'].includes(order.status)) throw new ConflictError('Order must be shipped/delivered first');

    const updated = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE orders SET status = 'COMPLETED', delivered_at = COALESCE(delivered_at, NOW()), confirmed_at = NOW(), completed_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [orderId]
      );

      await client.query("UPDATE listings SET status = 'SOLD', reserved_by_agent_id = NULL, reserved_until = NULL, updated_at = NOW() WHERE id = $1", [order.listing_id]);
      await client.query("UPDATE conversations SET state = 'CLOSED', updated_at = NOW() WHERE id = $1", [order.conversation_id]);
      await client.query("UPDATE agents SET buys_count = buys_count + 1 WHERE id = $1", [order.buyer_agent_id]);
      await client.query("UPDATE agents SET sales_count = sales_count + 1 WHERE id = $1", [order.seller_agent_id]);

      return result.rows[0];
    });

    await WalletService.settleEscrow({ buyerId, sellerId: order.seller_agent_id, orderId, amount: Number(order.amount), fee: Number(order.platform_fee || 0) });

    await EventService.emit('ORDER_CONFIRMED', buyerId, { order_id: orderId });
    await EventService.emit('ORDER_COMPLETED', buyerId, { order_id: orderId });
    return updated;
  }

  static async openDispute(orderId, actorId, reason) {
    const order = await this.getById(orderId, actorId);
    if (!['PAID_IN_ESCROW', 'SHIPPED', 'DELIVERED'].includes(order.status)) throw new ConflictError('Cannot dispute at this stage');
    if (!reason || !reason.trim()) throw new BadRequestError('Dispute reason is required');

    await queryOne(
      `UPDATE orders SET status = 'DISPUTED', dispute_reason = $2, disputed_by_agent_id = $3, disputed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [orderId, reason.trim(), actorId]
    );

    await EventService.emit('DISPUTE_OPENED', actorId, { order_id: orderId, reason });
    return { success: true, status: 'DISPUTED' };
  }

  static async resolveDispute(orderId, adminActorId, resolution) {
    const order = await queryOne('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (!order) throw new NotFoundError('Order');
    if (order.status !== 'DISPUTED') throw new ConflictError('Order is not disputed');

    if (!['refund_buyer', 'release_to_seller'].includes(resolution)) {
      throw new BadRequestError('resolution must be refund_buyer or release_to_seller');
    }

    let updated;
    if (resolution === 'refund_buyer') {
      await transaction(async (client) => {
        await client.query(
          `UPDATE agents SET wallet_reserved = GREATEST(wallet_reserved - $2, 0), updated_at = NOW() WHERE id = $1`,
          [order.buyer_agent_id, Number(order.amount)]
        );
        await client.query(
          `INSERT INTO wallet_ledger (agent_id, entry_type, amount, balance_after, related_order_id, note)
           VALUES ($1, 'ESCROW_RELEASE', $2, (SELECT wallet_balance FROM agents WHERE id = $1), $3, $4)`,
          [order.buyer_agent_id, Number(order.amount), order.id, 'Dispute refund release']
        );
        await client.query(`UPDATE orders SET status = 'REFUNDED', updated_at = NOW() WHERE id = $1`, [order.id]);
        await client.query("UPDATE listings SET status = 'ACTIVE', reserved_by_agent_id = NULL, reserved_until = NULL, updated_at = NOW() WHERE id = $1", [order.listing_id]);
      });
      updated = await queryOne('SELECT * FROM orders WHERE id = $1', [order.id]);
    } else {
      await WalletService.settleEscrow({
        buyerId: order.buyer_agent_id,
        sellerId: order.seller_agent_id,
        orderId: order.id,
        amount: Number(order.amount),
        fee: Number(order.platform_fee || 0)
      });
      updated = await queryOne(
        `UPDATE orders SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [order.id]
      );
    }

    await EventService.emit('DISPUTE_RESOLVED', adminActorId, { order_id: orderId, resolution });
    return updated;
  }
}

module.exports = OrderService;
