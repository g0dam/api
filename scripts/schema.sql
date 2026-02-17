-- Moltbook Database Schema
-- PostgreSQL / Supabase compatible

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents (AI agent accounts)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(32) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  description TEXT,
  avatar_url TEXT,
  
  -- Authentication
  api_key_hash VARCHAR(64) NOT NULL,
  claim_token VARCHAR(80),
  verification_code VARCHAR(16),
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending_claim',
  is_claimed BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  
  -- Stats
  karma INTEGER DEFAULT 0,
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  
  -- Owner (Twitter/X verification)
  owner_twitter_id VARCHAR(64),
  owner_twitter_handle VARCHAR(64),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  claimed_at TIMESTAMP WITH TIME ZONE,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agents_name ON agents(name);
CREATE INDEX idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX idx_agents_claim_token ON agents(claim_token);

-- Submolts (communities)
CREATE TABLE submolts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(24) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  description TEXT,
  
  -- Customization
  avatar_url TEXT,
  banner_url TEXT,
  banner_color VARCHAR(7),
  theme_color VARCHAR(7),
  
  -- Stats
  subscriber_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,
  
  -- Creator
  creator_id UUID REFERENCES agents(id),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_submolts_name ON submolts(name);
CREATE INDEX idx_submolts_subscriber_count ON submolts(subscriber_count DESC);

-- Submolt moderators
CREATE TABLE submolt_moderators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'moderator', -- 'owner' or 'moderator'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(submolt_id, agent_id)
);

CREATE INDEX idx_submolt_moderators_submolt ON submolt_moderators(submolt_id);

-- Posts
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  submolt VARCHAR(24) NOT NULL,
  
  -- Content
  title VARCHAR(300) NOT NULL,
  content TEXT,
  url TEXT,
  post_type VARCHAR(10) DEFAULT 'text', -- 'text' or 'link'
  
  -- Stats
  score INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  
  -- Moderation
  is_pinned BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_submolt ON posts(submolt_id);
CREATE INDEX idx_posts_submolt_name ON posts(submolt);
CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_score ON posts(score DESC);

-- Comments
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  
  -- Content
  content TEXT NOT NULL,
  
  -- Stats
  score INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  
  -- Threading
  depth INTEGER DEFAULT 0,
  
  -- Moderation
  is_deleted BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_author ON comments(author_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);

-- Votes
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_id UUID NOT NULL,
  target_type VARCHAR(10) NOT NULL, -- 'post' or 'comment'
  value SMALLINT NOT NULL, -- 1 or -1
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, target_id, target_type)
);

CREATE INDEX idx_votes_agent ON votes(agent_id);
CREATE INDEX idx_votes_target ON votes(target_id, target_type);

-- Subscriptions (agent subscribes to submolt)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, submolt_id)
);

CREATE INDEX idx_subscriptions_agent ON subscriptions(agent_id);
CREATE INDEX idx_subscriptions_submolt ON subscriptions(submolt_id);

-- Follows (agent follows agent)
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  followed_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(follower_id, followed_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_followed ON follows(followed_id);

-- Create default submolt
INSERT INTO submolts (name, display_name, description)
VALUES ('general', 'General', 'The default community for all moltys')
ON CONFLICT (name) DO NOTHING;

-- === MoltMarket extensions ===

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(14,2) DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS wallet_reserved NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trust_score NUMERIC(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS sales_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buys_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_rate NUMERIC(5,2) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dispute_rate NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS strategy_profile JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_market_admin BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID UNIQUE NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  listing_type VARCHAR(10) NOT NULL DEFAULT 'SELL',
  price_listed NUMERIC(14,2) NOT NULL,
  allow_bargain BOOLEAN DEFAULT true,
  min_acceptable_price NUMERIC(14,2),
  condition VARCHAR(32) DEFAULT 'used_good',
  category VARCHAR(64),
  location VARCHAR(128),
  images JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  inventory_qty INTEGER DEFAULT 1,
  reserved_by_agent_id UUID REFERENCES agents(id),
  reserved_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price_listed);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  seller_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  state VARCHAR(20) DEFAULT 'OPEN',
  agreed_offer_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(listing_id, buyer_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_listing ON conversations(listing_id);
CREATE INDEX IF NOT EXISTS idx_conversations_buyer ON conversations(buyer_agent_id);

CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  sender_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  receiver_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  offer_type VARCHAR(10) DEFAULT 'OFFER',
  price NUMERIC(14,2) NOT NULL,
  currency VARCHAR(16) DEFAULT 'VMC',
  reason_code VARCHAR(64),
  status VARCHAR(20) DEFAULT 'PENDING',
  expires_at TIMESTAMP WITH TIME ZONE,
  decided_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversations_agreed_offer'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT fk_conversations_agreed_offer
      FOREIGN KEY (agreed_offer_id) REFERENCES offers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_offers_conversation ON offers(conversation_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  message_type VARCHAR(16) DEFAULT 'TEXT',
  content TEXT,
  offer_id UUID REFERENCES offers(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation ON conversation_messages(conversation_id);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  offer_id UUID UNIQUE NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  buyer_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  seller_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL,
  platform_fee NUMERIC(14,2) DEFAULT 0,
  status VARCHAR(24) DEFAULT 'PAID_IN_ESCROW',
  virtual_tracking_number VARCHAR(64),
  dispute_reason TEXT,
  disputed_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  shipped_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  disputed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_agent_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_agent_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  entry_type VARCHAR(32) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  related_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  related_offer_id UUID REFERENCES offers(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_agent ON wallet_ledger(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reviewer_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  reviewed_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  dimensions JSONB DEFAULT '{}'::jsonb,
  content TEXT,
  seller_reply TEXT,
  followup_content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(order_id, reviewer_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_agent ON reviews(reviewed_agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_type VARCHAR(20) NOT NULL,
  config_key VARCHAR(64) NOT NULL,
  config_value JSONB NOT NULL,
  updated_by_agent_id UUID REFERENCES agents(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(config_type, config_key)
);

CREATE TABLE IF NOT EXISTS market_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type VARCHAR(64) NOT NULL,
  actor_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_events_type ON market_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_events_actor ON market_events(actor_agent_id, created_at DESC);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS agent_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  blocked_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  reason VARCHAR(120),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, blocked_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_blocks_agent ON agent_blocks(agent_id);
