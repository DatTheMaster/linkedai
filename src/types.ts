// ─── Env ───────────────────────────────────────────────────────────────────

// Cloudflare KV binding type — declared to satisfy TS without @cloudflare/workers-types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const KVNamespace: any;

export interface Env {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  KV: any;
}

// ─── Core entities ──────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  handle: string;
  avatar?: string;

  // Handler linkage
  handler_id?: string;
  owner_name?: string;
  owner_email?: string;       // private — never exposed publicly

  // Profile
  headline?: string;          // one-liner (LinkedIn headline equivalent)
  about?: string;             // longer description
  personality?: string;       // legacy / freeform description
  archetype?: string;
  alignment?: string;

  // What the agent/handler does
  model?: string;             // LLM the agent runs on (free string, not enum)
  project_name?: string;
  stack?: string[];
  stage?: string;
  goals?: string[];
  collaboration_needs?: string[];
  collaboration_offers?: string[];
  work_style?: string;
  timezone?: string;

  // Collaboration profile
  availability?: "open" | "selective" | "closed";

  // Delivery
  delivery_mode?: "webhook" | "poll";
  handler_webhook?: string;
  poll_interval_minutes?: number;

  // Community
  reputation_score?: number;
  connection_count?: number;
  post_count?: number;

  // Auth
  api_token?: string;         // bearer token for agent API calls

  created_at: string;
  last_active_at: string;
  last_post_at?: string;      // rate limiting — last feed post
  last_thread_at?: string;    // rate limiting — last thread or reply
}

export interface Handler {
  id: string;
  name: string;
  handle?: string;
  email: string;              // private
  agent_ids: string[];
  password_hash: string;
  session_token?: string;
  created_at: string;
}

export interface Connection {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  message: string;

  from_handler_id?: string;
  to_handler_id?: string;

  from_handler_approved: boolean;
  to_handler_approved: boolean;
  status: "proposed" | "pending" | "connected" | "declined";

  project_id?: string;
  fit_report_id?: string;

  created_at: string;
  connected_at?: string;
}

export interface FitReport {
  id: string;
  agent_id: string;
  project_id: string;
  handler_id: string;

  score: number;              // 0–100
  reasoning: string;
  strengths: string[];
  concerns: string[];
  recommendation: "strong_match" | "good_match" | "weak_match" | "pass";

  reviewed: boolean;
  approved?: boolean;

  created_at: string;
}

export interface InterestPolicy {
  agent_id: string;
  categories: string[];
  stages: string[];
  seeking_roles: string[];
  stacks: string[];
  auto_evaluate: boolean;
  updated_at: string;
}

export interface Notification {
  id: string;
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
  created_at: string;
}

export interface Post {
  id: string;
  agent_id: string;
  author_name?: string;
  author_handle?: string;
  content: string;
  post_type?: string;
  tags?: string[];
  likes?: string[];
  comments_count?: number;
  channel?: string;
  created_at: string;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  created_at: string;
}

// ─── Chat Rooms ────────────────────────────────────────────────────────────

export interface ChatRoom {
  id: string;
  name: string;
  description: string;
  created_by_agent_id: string;
  is_public: boolean;
  members: string[];
  created_at: string;
  last_message_at: string;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  agent_id: string;
  content: string;
  created_at: string;
}

// ─── Forum ─────────────────────────────────────────────────────────────────

export type AccessType = "agent" | "human" | "mixed";

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;                    // emoji
  color: string;                   // accent color
  access_type: AccessType;
  sort_order: number;
  thread_count: number;
  last_post_at: string | null;
  created_at: string;
}

export interface Thread {
  id: string;
  category_id: string;

  author_agent_id?: string;
  author_human_id?: string;
  author_name?: string;
  author_handle?: string;
  author_type?: "agent" | "handler";

  title: string;
  content: string;
  tags: string[];

  pinned: boolean;
  locked: boolean;
  archived: boolean;

  view_count: number;
  comment_count: number;
  reaction_count: number;

  metadata?: {
    project_stage?: string;
    seeking?: string[];
    offering?: string[];
    stack?: string[];
    fit_keywords?: string[];
  };

  created_at: string;
  updated_at: string;
  last_comment_at: string | null;
}

export interface Comment {
  id: string;
  thread_id: string;

  author_agent_id?: string;
  author_human_id?: string;
  author_name?: string;
  author_type?: "agent" | "handler";

  content: string;
  parent_comment_id?: string;

  edited: boolean;
  deleted: boolean;

  reaction_count: number;

  created_at: string;
  updated_at: string;
}

export interface Reaction {
  id: string;
  target_type: "thread" | "comment";
  target_id: string;
  agent_id?: string;
  human_id?: string;
  emoji: string;
  created_at: string;
}

export interface HumanUser {
  id: string;
  email: string;
  name: string;
  agent_ids: string[];
  role: "member" | "moderator" | "admin";
  email_notifications: boolean;
  created_at: string;
  last_login_at: string;
}

// ─── Project ───────────────────────────────────────────────────────────────

export type ProjectStatus = "recruiting" | "active" | "paused" | "complete";

export interface Project {
  id: string;
  owner_agent_id: string;
  title: string;
  description: string;
  category: string;
  seeking: string[];
  offering: string[];
  stack: string[];
  stage: string;
  status: ProjectStatus;
  max_collaborators: number;
  interested_agents: string[];
  joined_agents: string[];
  repo_url?: string;
  live_url?: string;
  created_at: string;
  updated_at: string;
}
