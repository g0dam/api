const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const EventService = require('./EventService');
const ListingService = require('./ListingService');
const AgentService = require('./AgentService');

class ConversationService {
  static async create({ listingId, buyerId }) {
    const listing = await ListingService.findById(listingId);
    if (listing.seller_id === buyerId) throw new BadRequestError('Cannot open a conversation with yourself');
    if (listing.status !== 'ACTIVE') throw new ConflictError('Listing is not active');

    if (await AgentService.isBlocked(buyerId, listing.seller_id)) {
      throw new ForbiddenError('Conversation blocked by trust settings');
    }

    const existing = await queryOne(
      'SELECT * FROM conversations WHERE listing_id = $1 AND buyer_agent_id = $2 AND state IN (\'OPEN\',\'OFFER_PENDING\',\'AGREED\')',
      [listingId, buyerId]
    );

    if (existing) return existing;

    const conversation = await queryOne(
      `INSERT INTO conversations (listing_id, buyer_agent_id, seller_agent_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [listingId, buyerId, listing.seller_id]
    );

    await EventService.emit('CONVERSATION_STARTED', buyerId, { conversation_id: conversation.id, listing_id: listingId });
    return conversation;
  }

  static async getById(id, actorId) {
    const convo = await queryOne('SELECT * FROM conversations WHERE id = $1', [id]);
    if (!convo) throw new NotFoundError('Conversation');
    if (![convo.buyer_agent_id, convo.seller_agent_id].includes(actorId)) throw new ForbiddenError('Cannot access this conversation');

    const messages = await queryAll(
      `SELECT id, conversation_id, sender_agent_id, message_type, content, offer_id, created_at
       FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    return { ...convo, messages };
  }

  static async sendMessage({ conversationId, senderId, content }) {
    if (!content || !content.trim()) throw new BadRequestError('Message content is required');
    const convo = await queryOne('SELECT * FROM conversations WHERE id = $1', [conversationId]);
    if (!convo) throw new NotFoundError('Conversation');
    if (![convo.buyer_agent_id, convo.seller_agent_id].includes(senderId)) throw new ForbiddenError('Cannot write in this conversation');
    if (convo.state === 'CLOSED') throw new ConflictError('Conversation is closed');

    const msg = await queryOne(
      `INSERT INTO conversation_messages (conversation_id, sender_agent_id, message_type, content)
       VALUES ($1, $2, 'TEXT', $3)
       RETURNING *`,
      [conversationId, senderId, content.trim()]
    );

    await EventService.emit('MESSAGE_SENT', senderId, { conversation_id: conversationId, message_id: msg.id });
    return msg;
  }

  static async createOffer({ conversationId, senderId, price, reasonCode = null, expiresMinutes = 60, type = 'OFFER' }) {
    if (!price || Number(price) <= 0) throw new BadRequestError('price must be > 0');
    const convo = await queryOne('SELECT * FROM conversations WHERE id = $1', [conversationId]);
    if (!convo) throw new NotFoundError('Conversation');
    if (![convo.buyer_agent_id, convo.seller_agent_id].includes(senderId)) throw new ForbiddenError('Cannot offer in this conversation');
    if (convo.state === 'CLOSED') throw new ConflictError('Conversation is closed');

    const senderRole = senderId === convo.buyer_agent_id ? 'BUYER' : 'SELLER';

    const offer = await transaction(async (client) => {
      const offerResult = await client.query(
        `INSERT INTO offers (conversation_id, listing_id, sender_agent_id, receiver_agent_id, offer_type, price, reason_code, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 || ' minutes')::interval)
         RETURNING *`,
        [conversationId, convo.listing_id, senderId, senderId === convo.buyer_agent_id ? convo.seller_agent_id : convo.buyer_agent_id, type, Number(price), reasonCode, String(expiresMinutes)]
      );

      const inserted = offerResult.rows[0];

      await client.query(
        `INSERT INTO conversation_messages (conversation_id, sender_agent_id, message_type, content, offer_id)
         VALUES ($1, $2, 'OFFER', $3, $4)`,
        [conversationId, senderId, JSON.stringify({ price: Number(price), offer_type: type, reason_code: reasonCode, role: senderRole }), inserted.id]
      );

      await client.query("UPDATE conversations SET state = 'OFFER_PENDING', updated_at = NOW() WHERE id = $1", [conversationId]);
      return inserted;
    });

    await EventService.emit(type === 'COUNTER' ? 'OFFER_COUNTER' : 'OFFER_SENT', senderId, { conversation_id: conversationId, offer_id: offer.id, price: Number(price) });
    return offer;
  }

  static async decideOffer({ offerId, actorId, action }) {
    const offer = await queryOne('SELECT * FROM offers WHERE id = $1', [offerId]);
    if (!offer) throw new NotFoundError('Offer');
    if (offer.receiver_agent_id !== actorId) throw new ForbiddenError('Only receiver can decide this offer');
    if (offer.status !== 'PENDING') throw new ConflictError('Offer is already processed');
    if (new Date(offer.expires_at).getTime() < Date.now()) throw new ConflictError('Offer has expired');

    const convo = await queryOne('SELECT * FROM conversations WHERE id = $1', [offer.conversation_id]);
    if (!convo) throw new NotFoundError('Conversation');

    let nextStatus = null;
    if (action === 'accept') nextStatus = 'ACCEPTED';
    if (action === 'reject') nextStatus = 'REJECTED';
    if (!nextStatus) throw new BadRequestError('Unknown action');

    const updated = await transaction(async (client) => {
      const offerResult = await client.query(
        `UPDATE offers SET status = $2, decided_at = NOW() WHERE id = $1 RETURNING *`,
        [offerId, nextStatus]
      );

      if (nextStatus === 'ACCEPTED') {
        await client.query("UPDATE conversations SET state = 'AGREED', agreed_offer_id = $2, updated_at = NOW() WHERE id = $1", [offer.conversation_id, offerId]);
        await client.query("UPDATE listings SET status = 'RESERVED', reserved_by_agent_id = $2, reserved_until = NOW() + interval '20 minutes', updated_at = NOW() WHERE id = $1", [offer.listing_id, convo.buyer_agent_id]);
      } else {
        await client.query("UPDATE conversations SET state = 'OPEN', updated_at = NOW() WHERE id = $1", [offer.conversation_id]);
      }

      return offerResult.rows[0];
    });

    await EventService.emit(nextStatus === 'ACCEPTED' ? 'OFFER_ACCEPTED' : 'OFFER_REJECTED', actorId, { offer_id: offerId, conversation_id: offer.conversation_id });
    return updated;
  }
}

module.exports = ConversationService;
