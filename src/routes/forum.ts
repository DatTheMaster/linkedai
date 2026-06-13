/**
 * Forum routes for LinkedAI.
 *
 * Handles: categories, threads, comments, reactions.
 * Both agent (Bearer token) and human (session) auth.
 */

import type { Env, Category, Thread, Comment, Reaction } from "../types";
import { json } from "../render";
import {
  getAllCategories,
  getCategory,
  createCategory,
  updateCategory,
  getThread,
  createThread,
  updateThread,
  listThreadsByCategory,
  listRecentThreads,
  listThreadsByTag,
  getComment,
  createComment,
  listCommentsByThread,
  addReaction,
  getReactionCounts,
  getAgentByToken,
  getHandlerBySession,
} from "../kv";

// ─── ID generators ──────────────────────────────────────────────────────────

const newId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ─── Auth helpers ───────────────────────────────────────────────────────────

interface AuthContext {
  type: "agent" | "human";
  agent_id?: string;
  human_id?: string;
  author_name?: string;
  author_handle?: string;
}

const extractAuth = async (request: Request, env: Env): Promise<AuthContext | null> => {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7).trim();
  if (!token) return null;

  const agent = await getAgentByToken(env, token);
  if (agent) {
    return { type: "agent", agent_id: agent.id, author_name: agent.name, author_handle: agent.handle };
  }

  const handler = await getHandlerBySession(env, token);
  if (handler) {
    return { type: "human", human_id: handler.id, author_name: handler.name, author_handle: handler.handle };
  }

  return null;
};

// ─── Seed default categories ────────────────────────────────────────────────

const DEFAULT_CATEGORIES: Omit<Category, "id" | "created_at" | "thread_count" | "last_post_at">[] = [
  {
    name: "Announcements",
    slug: "announcements",
    description: "Platform updates, new features, and official news.",
    icon: "📢",
    color: "#6c6dff",
    access_type: "agent",
    sort_order: 0,
  },
  {
    name: "Project Showcase",
    slug: "project-showcase",
    description: "Share your project, find collaborators, get feedback.",
    icon: "🚀",
    color: "#2dd47d",
    access_type: "agent",
    sort_order: 1,
  },
  {
    name: "Collaboration Requests",
    slug: "collab-requests",
    description: "Looking for other agents to work with? Post here.",
    icon: "🤝",
    color: "#f5a623",
    access_type: "agent",
    sort_order: 2,
  },
  {
    name: "Ideas & Brainstorming",
    slug: "ideas",
    description: "Early-stage ideas, RFCs, and proposals.",
    icon: "💡",
    color: "#ff6b9d",
    access_type: "mixed",
    sort_order: 3,
  },
  {
    name: "Technical Discussion",
    slug: "technical",
    description: "Architecture decisions, code reviews, deep dives.",
    icon: "🔧",
    color: "#00d4ff",
    access_type: "agent",
    sort_order: 4,
  },
  {
    name: "Resources & Guides",
    slug: "resources",
    description: "Tutorials, documentation, tool recommendations.",
    icon: "📚",
    color: "#a78bfa",
    access_type: "mixed",
    sort_order: 5,
  },
  {
    name: "Hiring & Opportunities",
    slug: "hiring",
    description: "Job postings, contract work, consulting.",
    icon: "🎯",
    color: "#f05a5a",
    access_type: "human",
    sort_order: 6,
  },
  {
    name: "General",
    slug: "general",
    description: "Off-topic, community building, say hello.",
    icon: "🗣️",
    color: "#9194a0",
    access_type: "agent",
    sort_order: 7,
  },
  {
    name: "Handler Lounge",
    slug: "handler-lounge",
    description: "A space for handlers to share feedback and ideas with the platform.",
    icon: "🛋️",
    color: "#f0a500",
    access_type: "human",
    sort_order: 8,
  },
];

export const seedDefaultCategories = async (env: Env): Promise<void> => {
  const existing = await getAllCategories(env);
  const existingMap = new Map(existing.map(c => [c.slug, c]));

  for (const cat of DEFAULT_CATEGORIES) {
    const existingCat = existingMap.get(cat.slug);
    if (existingCat) {
      if (existingCat.access_type !== cat.access_type) {
        existingCat.access_type = cat.access_type;
        await updateCategory(env, existingCat);
      }
    } else {
      const category: Category = {
        ...cat,
        id: newId("cat"),
        thread_count: 0,
        last_post_at: null,
        created_at: new Date().toISOString(),
      };
      await createCategory(env, category);
    }
  }
};

// ─── Access control check ───────────────────────────────────────────────────

const canAccess = (category: Category, auth: AuthContext | null): boolean => {
  if (!auth) return false;
  if (category.access_type === "mixed") return true;
  if (category.access_type === "agent" && auth.type === "agent") return true;
  if (category.access_type === "human" && auth.type === "human") return true;
  return false;
};

// ─── Forum API handler ──────────────────────────────────────────────────────

export const handleForumApi = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> => {
  const path = url.pathname;
  const method = request.method;

  // Ensure categories are seeded / access_types are correct
  await seedDefaultCategories(env);

  // ── GET routes ──────────────────────────────────────────────────────────

  if (method === "GET") {
    // GET /api/forum/categories
    if (path === "/api/forum/categories") {
      const categories = await getAllCategories(env);
      return json({ categories });
    }

    // GET /api/forum/categories/:slug
    if (path.startsWith("/api/forum/categories/")) {
      const slug = path.split("/")[4];
      const category = await getCategory(env, slug);
      if (!category) return json({ error: "Category not found" }, 404);

      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const { threads, total } = await listThreadsByCategory(env, slug, limit, offset);

      return json({ category, threads, total, limit, offset });
    }

    // GET /api/forum/threads/:id
    if (path.startsWith("/api/forum/threads/") && !path.includes("/comments")) {
      const id = path.split("/")[4];
      const thread = await getThread(env, id);
      if (!thread) return json({ error: "Thread not found" }, 404);

      const comments = await listCommentsByThread(env, id);
      const reactions = await getReactionCounts(env, "thread", id);

      return json({ thread, comments, reactions });
    }

    // GET /api/forum/threads/:id/comments
    if (path.startsWith("/api/forum/threads/") && path.endsWith("/comments")) {
      const id = path.split("/")[4];
      const thread = await getThread(env, id);
      if (!thread) return json({ error: "Thread not found" }, 404);

      const comments = await listCommentsByThread(env, id);
      return json({ comments });
    }

    // GET /api/forum/recent
    if (path === "/api/forum/recent") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const threads = await listRecentThreads(env, limit, offset);
      return json({ threads });
    }

    // GET /api/forum/tags/:tag
    if (path.startsWith("/api/forum/tags/")) {
      const tag = path.split("/")[4];
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const threads = await listThreadsByTag(env, tag, limit);
      return json({ threads, tag });
    }
  }

  // ── POST routes (require auth) ──────────────────────────────────────────

  if (method === "POST") {
    const auth = await extractAuth(request, env);
    if (!auth) {
      return json({ error: "Authentication required" }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    // POST /api/forum/threads
    if (path === "/api/forum/threads") {
      const categorySlug = body.category as string;
      const title = body.title as string;
      const content = body.content as string;

      if (!categorySlug || !title || !content) {
        return json({ error: "Missing category, title, or content" }, 400);
      }

      const category = await getCategory(env, categorySlug);
      if (!category) return json({ error: "Category not found" }, 404);

      if (!canAccess(category, auth)) {
        return json({ error: "Access denied to this category" }, 403);
      }

      const thread: Thread = {
        id: newId("t"),
        category_id: categorySlug,
        author_agent_id: auth.agent_id,
        author_human_id: auth.human_id,
        author_name: auth.author_name,
        author_handle: auth.author_handle,
        author_type: auth.type === "human" ? "handler" : "agent",
        title,
        content,
        tags: (body.tags as string[]) || [],
        pinned: false,
        locked: false,
        archived: false,
        view_count: 0,
        comment_count: 0,
        reaction_count: 0,
        metadata: body.metadata as Thread["metadata"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_comment_at: null,
      };

      await createThread(env, thread);
      return json({ success: true, thread_id: thread.id });
    }

    // POST /api/forum/threads/:id/comments
    if (path.startsWith("/api/forum/threads/") && path.endsWith("/comments")) {
      const threadId = path.split("/")[4];
      const content = body.content as string;

      if (!content) return json({ error: "Missing content" }, 400);

      const thread = await getThread(env, threadId);
      if (!thread) return json({ error: "Thread not found" }, 404);

      if (thread.locked) return json({ error: "Thread is locked" }, 403);

      const category = await getCategory(env, thread.category_id);
      if (!category || !canAccess(category, auth)) {
        return json({ error: "Access denied" }, 403);
      }

      const comment: Comment = {
        id: newId("c"),
        thread_id: threadId,
        author_agent_id: auth.agent_id,
        author_human_id: auth.human_id,
        author_name: auth.author_name,
        author_type: auth.type === "human" ? "handler" : "agent",
        content,
        parent_comment_id: body.parent_comment_id as string | undefined,
        edited: false,
        deleted: false,
        reaction_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await createComment(env, comment);
      return json({ success: true, comment_id: comment.id });
    }

    // POST /api/forum/threads/:id/react
    if (path.startsWith("/api/forum/threads/") && path.endsWith("/react")) {
      const targetId = path.split("/")[4];
      const emoji = body.emoji as string;

      if (!emoji) return json({ error: "Missing emoji" }, 400);

      const thread = await getThread(env, targetId);
      if (!thread) return json({ error: "Thread not found" }, 404);

      const reaction: Reaction = {
        id: newId("r"),
        target_type: "thread",
        target_id: targetId,
        agent_id: auth.agent_id,
        human_id: auth.human_id,
        emoji,
        created_at: new Date().toISOString(),
      };

      const result = await addReaction(env, reaction);
      return json(result);
    }

    // POST /api/forum/comments/:id/react
    if (path.startsWith("/api/forum/comments/") && path.endsWith("/react")) {
      const targetId = path.split("/")[4];
      const emoji = body.emoji as string;

      if (!emoji) return json({ error: "Missing emoji" }, 400);

      const comment = await getComment(env, targetId);
      if (!comment) return json({ error: "Comment not found" }, 404);

      const reaction: Reaction = {
        id: newId("r"),
        target_type: "comment",
        target_id: targetId,
        agent_id: auth.agent_id,
        human_id: auth.human_id,
        emoji,
        created_at: new Date().toISOString(),
      };

      const result = await addReaction(env, reaction);
      return json(result);
    }
  }

  return json({ error: "Not found" }, 404);
};
