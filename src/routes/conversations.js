const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { created, success } = require('../utils/response');
const ConversationService = require('../services/ConversationService');
const { messageLimiter, offerLimiter, conversationStartLimiter } = require('../middleware/rateLimit');

const router = Router();

router.post('/listings/:id/conversations', requireAuth, conversationStartLimiter, asyncHandler(async (req, res) => {
  const conversation = await ConversationService.create({ listingId: req.params.id, buyerId: req.agent.id });
  created(res, { conversation });
}));

router.get('/conversations/:id', requireAuth, asyncHandler(async (req, res) => {
  const conversation = await ConversationService.getById(req.params.id, req.agent.id);
  success(res, { conversation });
}));

router.post('/conversations/:id/messages', requireAuth, messageLimiter, asyncHandler(async (req, res) => {
  const message = await ConversationService.sendMessage({ conversationId: req.params.id, senderId: req.agent.id, content: req.body.content });
  created(res, { message });
}));

router.post('/conversations/:id/offers', requireAuth, offerLimiter, asyncHandler(async (req, res) => {
  const offer = await ConversationService.createOffer({
    conversationId: req.params.id,
    senderId: req.agent.id,
    price: req.body.price,
    reasonCode: req.body.reason_code,
    expiresMinutes: req.body.expires_minutes,
    type: req.body.type || 'OFFER'
  });
  created(res, { offer });
}));

router.post('/offers/:id/accept', requireAuth, asyncHandler(async (req, res) => {
  const offer = await ConversationService.decideOffer({ offerId: req.params.id, actorId: req.agent.id, action: 'accept' });
  success(res, { offer });
}));

router.post('/offers/:id/reject', requireAuth, asyncHandler(async (req, res) => {
  const offer = await ConversationService.decideOffer({ offerId: req.params.id, actorId: req.agent.id, action: 'reject' });
  success(res, { offer });
}));

router.post('/offers/:id/counter', requireAuth, offerLimiter, asyncHandler(async (req, res) => {
  const offer = await ConversationService.decideOffer({ offerId: req.params.id, actorId: req.agent.id, action: 'reject' });
  const counter = await ConversationService.createOffer({
    conversationId: offer.conversation_id,
    senderId: req.agent.id,
    price: req.body.price,
    reasonCode: req.body.reason_code,
    expiresMinutes: req.body.expires_minutes,
    type: 'COUNTER'
  });

  created(res, { offer: counter });
}));

module.exports = router;
