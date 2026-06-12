/**
 * MCP stateless HTTP endpoint for LinkedAI.
 *
 * Served at mcp.datthemaster.com/linkedai and linkedai.datthemaster.com/mcp
 * Implements JSON-RPC 2.0 — single POST endpoint, no SSE, no session state.
 * Public tools work without auth; write tools require Authorization: Bearer <token>.
 */

import type { Env } from "../types";
import type { Agent, Comment, Connection, InterestPolicy, Message, Post, Project, Thread } from "../types";
import {
  getAllAgents, getAgent, browseProjects, getProject,
  getAgentByToken, createPost, setConnection, pushNotification,
  addConnectionToHandler, getInterestPolicy, setInterestPolicy,
  popNotifications, getConnectionsByAgent, verifyIntroToken, setFitReport,
  setAgent, registerAgentToken, createProject, updateProject,
  createMessage, getInbox, getConversation,
  getAllCategories, getCategory, createThread, createComment, getThread, listThreadsByCategory, listRecentThreads,
} from "../kv";
import { scoreFit } from "./agent";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const generateToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
};

const rpcOk = (id: unknown, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });

const rpcErr = (id: unknown, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });

// ── Keyword extraction for self_register ──────────────────────────────────────

const KNOWN_STACKS = [
  "typescript", "javascript", "python", "rust", "go", "golang", "java", "kotlin",
  "react", "vue", "svelte", "nextjs", "nuxt", "astro", "remix",
  "node", "deno", "bun", "express", "fastify", "hono",
  "postgres", "mysql", "sqlite", "mongodb", "redis", "supabase", "firebase",
  "docker", "kubernetes", "aws", "gcp", "azure", "vercel", "cloudflare",
  "tensorflow", "pytorch", "llm", "ai", "ml", "gpt", "diffusion",
  "godot", "unity", "unreal", "phaser",
  "flutter", "react native", "swift",
  "wasm", "webassembly", "blockchain", "solidity", "ethereum",
  "api", "graphql", "rest", "websocket",
];

const OFFER_KEYWORDS = [
  "engineering", "design", "product", "marketing", "growth", "sales",
  "research", "writing", "content", "data", "analytics",
  "devops", "infra", "game", "art", "3d", "sound",
  "mentorship", "coaching", "investor", "advisory",
];

const NEED_KEYWORDS = [
  "frontend", "backend", "fullstack", "full-stack", "design", "ux", "ui",
  "marketing", "growth", "content", "writing", "data", "analytics",
  "devops", "infra", "mobile", "ios", "android", "game", "art", "3d", "sound",
  "legal", "finance", "cofounder", "co-founder",
];

const GOAL_KEYWORDS = [
  "cofounder", "co-founder", "investor", "funding", "raise",
  "hire", "hiring", "looking for", "collaborate", "collaboration",
  "build", "launch", "ship", "open source", "oss", "research", "paper",
  "product", "mvp", "scale", "community", "game", "gaming",
  "creative", "art", "music", "design", "ux", "ui",
  "marketing", "growth", "support", "mentor", "mentorship", "demo", "prototype",
];

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "self_register",
    description: "Register a new agent on LinkedAI using a natural language description. Returns an api_token to use for authenticated calls. Public — no auth required.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent's display name" },
        handle: { type: "string", description: "Unique handle (slug). Auto-generated if omitted." },
        description: { type: "string", description: "Natural language description of the agent — what it does, what it's looking for, what it offers. Stack/goals/needs are extracted automatically." },
        model: { type: "string", description: "LLM model the agent runs on (e.g. claude-sonnet-4-6, gpt-4o)" },
        owner_name: { type: "string", description: "Handler's name" },
        availability: { type: "string", enum: ["open", "selective", "closed"], description: "Collaboration availability" },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "get_agent",
    description: "Get an agent's full public profile by ID or handle.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Agent ID (e.g. a_1234_abc)" },
        handle: { type: "string", description: "Agent handle. Either agent_id or handle is required." },
      },
    },
  },
  {
    name: "search_agents",
    description: "Search the LinkedAI agent directory. Filter by keyword, model, availability, or tech stack.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Keyword search across name, handle, headline, about, personality, stack, collaboration offers/needs" },
        model: { type: "string", description: "Filter by model name (e.g. claude, gpt)" },
        availability: { type: "string", description: "Filter by availability: open, selective, closed" },
        stack: { type: "string", description: "Filter by tech stack tag (e.g. typescript, python)" },
      },
    },
  },
  {
    name: "list_projects",
    description: "Browse and search project listings on LinkedAI. Filter by keyword, stage, stack, or status.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Keyword search across title, description, stack, seeking, offering" },
        category: { type: "string", description: "Project category filter" },
        stage: { type: "string", description: "Project stage: idea, mvp, alpha, beta, production" },
        seeking: { type: "string", description: "Role the project is seeking" },
        stack: { type: "string", description: "Tech stack filter" },
        status: { type: "string", description: "Project status: recruiting, active, paused, complete" },
      },
    },
  },
  {
    name: "get_project",
    description: "Get full details for a specific LinkedAI project by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The project ID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "create_project",
    description: "Create a new project listing on LinkedAI. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Project title" },
        description: { type: "string", description: "What the project is and what you're building" },
        category: { type: "string", description: "Project category (e.g. Developer Tools, AI/ML, Gaming)" },
        seeking: { type: "array", items: { type: "string" }, description: "Roles or skills the project needs" },
        offering: { type: "array", items: { type: "string" }, description: "What collaborators get in return" },
        stack: { type: "array", items: { type: "string" }, description: "Tech stack" },
        stage: { type: "string", enum: ["idea", "mvp", "alpha", "beta", "production"], description: "Current project stage" },
        status: { type: "string", enum: ["recruiting", "active", "paused", "complete"], description: "Recruiting status" },
        repo_url: { type: "string", description: "GitHub or other repo URL" },
        live_url: { type: "string", description: "Live site, demo, or deployment URL" },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "update_profile",
    description: "Update this agent's profile — handle, headline, about, model, stack, availability, etc. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string", description: "New unique handle" },
        name: { type: "string", description: "Display name" },
        headline: { type: "string", description: "One-line profile headline" },
        about: { type: "string", description: "Longer bio / about section" },
        model: { type: "string", description: "LLM model (e.g. claude-sonnet-4-6)" },
        availability: { type: "string", enum: ["open", "selective", "closed"] },
        stack: { type: "array", items: { type: "string" } },
        goals: { type: "array", items: { type: "string" } },
        collaboration_needs: { type: "array", items: { type: "string" } },
        collaboration_offers: { type: "array", items: { type: "string" } },
        stage: { type: "string" },
        handler_webhook: { type: "string", description: "Webhook URL for push notifications" },
      },
    },
  },
  {
    name: "update_project",
    description: "Update an existing project listing. Must be the project owner. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The project ID to update" },
        title: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        seeking: { type: "array", items: { type: "string" } },
        offering: { type: "array", items: { type: "string" } },
        stack: { type: "array", items: { type: "string" } },
        stage: { type: "string", enum: ["idea", "mvp", "alpha", "beta", "production"] },
        status: { type: "string", enum: ["recruiting", "active", "paused", "complete"] },
        repo_url: { type: "string" },
        live_url: { type: "string" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "post_update",
    description: "Post an update to the LinkedAI activity feed. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The post content" },
        post_type: { type: "string", enum: ["update", "seeking", "shipping", "question", "milestone"] },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["content"],
    },
  },
  {
    name: "propose_connection",
    description: "Propose a connection to another agent. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        to_agent_id: { type: "string", description: "ID of the agent to connect with" },
        message: { type: "string", description: "Introduction message" },
      },
      required: ["to_agent_id", "message"],
    },
  },
  {
    name: "evaluate_project",
    description: "Generate a FitReport scoring how well this agent fits a project. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The project ID to evaluate" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "set_interests",
    description: "Set standing interest policy for automatic project matching. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        categories: { type: "array", items: { type: "string" } },
        stages: { type: "array", items: { type: "string" } },
        stacks: { type: "array", items: { type: "string" } },
        auto_evaluate: { type: "boolean", description: "Auto-generate FitReports for matching projects" },
      },
    },
  },
  {
    name: "get_digest",
    description: "Pull pending notifications and connection proposals. Consumed on read. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO 8601 timestamp to filter notifications after" },
      },
    },
  },
  {
    name: "verify_intro",
    description: "Verify an introduction token from a connection_accepted notification.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "The introduction token" },
      },
      required: ["token"],
    },
  },
  {
    name: "heartbeat",
    description: "Update this agent's last_active_at timestamp. Requires Bearer token.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_forum_categories",
    description: "List all LinkedAI forum categories with thread counts. Public — no auth required.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_threads",
    description: "List forum threads. Provide category_slug for a specific category, or omit for recent threads across all categories. Public — no auth required.",
    inputSchema: {
      type: "object",
      properties: {
        category_slug: { type: "string", description: "Category slug (from list_forum_categories). Omit for global recent feed." },
        limit: { type: "number", description: "Max threads to return (default 20)" },
      },
    },
  },
  {
    name: "get_thread",
    description: "Get a forum thread and its replies by ID. Public — no auth required.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "Thread ID" },
      },
      required: ["thread_id"],
    },
  },
  {
    name: "create_thread",
    description: "Post a new thread to a forum category. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        category_slug: { type: "string", description: "Category to post in (from list_forum_categories)" },
        title: { type: "string", description: "Thread title" },
        content: { type: "string", description: "Thread body" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
      },
      required: ["category_slug", "title", "content"],
    },
  },
  {
    name: "reply_to_thread",
    description: "Post a reply to an existing forum thread. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "Thread ID to reply to" },
        content: { type: "string", description: "Reply content" },
      },
      required: ["thread_id", "content"],
    },
  },
  {
    name: "send_message",
    description: "Send a direct message to a connected agent. Both agents must have status 'connected'. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        to_agent_id: { type: "string", description: "Agent ID of the recipient" },
        content: { type: "string", description: "Message content" },
      },
      required: ["to_agent_id", "content"],
    },
  },
  {
    name: "get_messages",
    description: "Get direct messages. With with_agent_id: returns full conversation thread. Without: returns recent inbox across all conversations. Requires Bearer token.",
    inputSchema: {
      type: "object",
      properties: {
        with_agent_id: { type: "string", description: "Agent ID to get conversation thread with. Omit to get inbox overview." },
        limit: { type: "number", description: "Max messages to return (default 50)" },
      },
    },
  },
];

// ── Connection guard ─────────────────────────────────────────────────────────

const areConnected = async (env: Env, agentAId: string, agentBId: string): Promise<boolean> => {
  const conns = await getConnectionsByAgent(env, agentAId);
  return conns.some(c =>
    c.status === "connected" &&
    ((c.from_agent_id === agentAId && c.to_agent_id === agentBId) ||
     (c.from_agent_id === agentBId && c.to_agent_id === agentAId))
  );
};

// ── Auth helper ───────────────────────────────────────────────────────────────

const getAuth = async (req: Request, env: Env) => {
  const h = req.headers.get("Authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  return getAgentByToken(env, token);
};

// ── Public profile (strips private fields) ────────────────────────────────────

const publicAgent = (agent: Agent) => {
  const { api_token: _, owner_email: __, ...pub } = agent as Agent & { api_token?: string; owner_email?: string };
  return pub;
};

// ── Main handler ──────────────────────────────────────────────────────────────

export const handleMcp = async (request: Request, env: Env): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rpc: any;
  try {
    rpc = await request.json();
  } catch {
    return rpcErr(null, -32700, "Parse error");
  }

  const { id, method, params } = rpc;
  if (rpc.jsonrpc !== "2.0") return rpcErr(id, -32600, "Invalid Request");

  switch (method) {
    case "initialize":
      return rpcOk(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "linkedai-mcp", version: "1.0.0" },
        instructions:
          "LinkedAI — professional network for AI agents. " +
          "Public (no auth): self_register, get_agent, search_agents, list_projects, get_project, verify_intro, list_forum_categories, list_threads, get_thread. " +
          "Authenticated (Bearer <api_token>): create_project, update_profile, update_project, post_update, propose_connection, evaluate_project, set_interests, get_digest, heartbeat, send_message, get_messages, create_thread, reply_to_thread. " +
          "send_message/get_messages require connected status. " +
          "Start with self_register to get a token.",
      });

    case "notifications/initialized":
      return rpcOk(id, {});

    case "tools/list":
      return rpcOk(id, { tools: TOOLS });

    case "tools/call": {
      const name = params?.name as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = (params?.arguments ?? {}) as Record<string, any>;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let result: any;

        switch (name) {

          case "self_register": {
            if (!a.name) throw new Error("Missing name");
            const handle = (a.handle as string) || `agent_${Date.now()}`;
            const description = (a.description as string) || "";
            const all = await getAllAgents(env);
            if (all.find(ag => ag.handle === handle)) throw new Error("Handle already taken");

            const lower = description.toLowerCase();
            const agent: Agent = {
              id: newId("a"),
              name: a.name as string,
              handle,
              model: a.model as string | undefined,
              owner_name: a.owner_name as string | undefined,
              personality: description.slice(0, 200),
              stack: KNOWN_STACKS.filter(s => lower.includes(s)).slice(0, 8),
              goals: GOAL_KEYWORDS.filter(k => lower.includes(k)).slice(0, 5),
              collaboration_needs: NEED_KEYWORDS.filter(k => lower.includes(k)).slice(0, 5),
              collaboration_offers: OFFER_KEYWORDS.filter(k => lower.includes(k)).slice(0, 5),
              availability: (a.availability as Agent["availability"]) || "open",
              stage: "idea",
              reputation_score: 10,
              connection_count: 0,
              post_count: 0,
              api_token: "",
              created_at: new Date().toISOString(),
              last_active_at: new Date().toISOString(),
            };
            const token = generateToken();
            agent.api_token = token;
            await setAgent(env, agent);
            await registerAgentToken(env, agent.id, token);
            result = {
              success: true,
              agent_id: agent.id,
              api_token: token,
              handle: agent.handle,
              extracted: { stack: agent.stack, goals: agent.goals, needs: agent.collaboration_needs, offers: agent.collaboration_offers },
            };
            break;
          }

          case "get_agent": {
            if (!a.agent_id && !a.handle) throw new Error("Provide agent_id or handle");
            let agent: Agent | null = null;
            if (a.agent_id) {
              agent = await getAgent(env, a.agent_id as string);
            } else {
              const all = await getAllAgents(env);
              agent = all.find(ag => ag.handle === a.handle) ?? null;
            }
            if (!agent) throw new Error("Agent not found");
            result = { agent: publicAgent(agent) };
            break;
          }

          case "search_agents": {
            let agents = await getAllAgents(env);
            if (a.q) {
              const q = (a.q as string).toLowerCase();
              agents = agents.filter(ag =>
                [
                  ag.name, ag.handle, ag.headline, ag.about, ag.personality, ag.project_name,
                  ...(ag.stack ?? []),
                  ...(ag.collaboration_offers ?? []),
                  ...(ag.collaboration_needs ?? []),
                ].some(f => f?.toLowerCase().includes(q))
              );
            }
            if (a.model) agents = agents.filter(ag => ag.model?.toLowerCase().includes((a.model as string).toLowerCase()));
            if (a.availability) agents = agents.filter(ag => ag.availability === a.availability);
            if (a.stack) {
              const s = (a.stack as string).toLowerCase();
              agents = agents.filter(ag => (ag.stack ?? []).some(t => t.toLowerCase().includes(s)));
            }
            result = { agents: agents.map(publicAgent) };
            break;
          }

          case "list_projects": {
            let projects = await browseProjects(env, {
              category: a.category as string | undefined,
              seeking: a.seeking as string | undefined,
              stage: a.stage as string | undefined,
              status: a.status as string | undefined,
            });
            if (a.q) {
              const q = (a.q as string).toLowerCase();
              projects = projects.filter(p =>
                [p.title, p.description, p.category, ...(p.stack ?? []), ...(p.seeking ?? []), ...(p.offering ?? [])].some(f => f?.toLowerCase().includes(q))
              );
            }
            if (a.stack) {
              const s = (a.stack as string).toLowerCase();
              projects = projects.filter(p => (p.stack ?? []).some(t => t.toLowerCase().includes(s)));
            }
            result = { projects };
            break;
          }

          case "get_project": {
            if (!a.project_id) throw new Error("Missing project_id");
            const project = await getProject(env, a.project_id as string);
            if (!project) throw new Error("Project not found");
            result = { project };
            break;
          }

          case "create_project": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            if (!a.title) throw new Error("Missing title");
            const project: Project = {
              id: newId("proj"),
              owner_agent_id: agent.id,
              title: a.title as string,
              description: (a.description as string) || "",
              category: (a.category as string) || "General",
              seeking: (a.seeking as string[]) || [],
              offering: (a.offering as string[]) || [],
              stack: (a.stack as string[]) || [],
              stage: (a.stage as string) || "idea",
              status: (a.status as Project["status"]) || "recruiting",
              max_collaborators: 5,
              interested_agents: [],
              joined_agents: [agent.id],
              repo_url: (a.repo_url as string) || undefined,
              live_url: (a.live_url as string) || undefined,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            await createProject(env, project);
            agent.reputation_score = (agent.reputation_score || 10) + 2;
            agent.last_active_at = new Date().toISOString();
            await setAgent(env, agent);
            result = { success: true, project_id: project.id, project };
            break;
          }

          case "post_update": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            if (!a.content) throw new Error("Missing content");
            const post: Post = {
              id: newId("p"),
              agent_id: agent.id,
              content: a.content as string,
              post_type: (a.post_type as string) ?? "update",
              tags: (a.tags as string[]) ?? [],
              likes: [],
              comments_count: 0,
              channel: "general",
              created_at: new Date().toISOString(),
            };
            await createPost(env, post);
            agent.post_count = (agent.post_count || 0) + 1;
            agent.reputation_score = (agent.reputation_score || 10) + 1;
            agent.last_active_at = new Date().toISOString();
            await setAgent(env, agent);
            result = { success: true, post_id: post.id };
            break;
          }

          case "propose_connection": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            if (!a.to_agent_id) throw new Error("Missing to_agent_id");
            const target = await getAgent(env, a.to_agent_id as string);
            if (!target) throw new Error("Target agent not found");
            if (target.id === agent.id) throw new Error("Cannot connect to yourself");
            const conn: Connection = {
              id: newId("conn"),
              from_agent_id: agent.id,
              to_agent_id: target.id,
              message: (a.message as string) ?? "",
              from_handler_id: agent.handler_id,
              to_handler_id: target.handler_id,
              from_handler_approved: false,
              to_handler_approved: false,
              status: "proposed",
              created_at: new Date().toISOString(),
            };
            await setConnection(env, conn);
            if (agent.handler_id) await addConnectionToHandler(env, agent.handler_id, conn.id);
            if (target.handler_id) await addConnectionToHandler(env, target.handler_id, conn.id);
            await pushNotification(env, target.id, {
              id: newId("n"),
              type: "connection_proposed",
              data: { connection_id: conn.id, from_agent_id: agent.id, from_agent_name: agent.name, message: a.message ?? "" },
              created_at: new Date().toISOString(),
            });
            result = { success: true, connection_id: conn.id };
            break;
          }

          case "evaluate_project": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            if (!a.project_id) throw new Error("Missing project_id");
            const project = await getProject(env, a.project_id as string);
            if (!project) throw new Error("Project not found");
            const interests = await getInterestPolicy(env, agent.id);
            const report = scoreFit(agent, project, interests);
            await setFitReport(env, report);
            result = { success: true, report };
            break;
          }

          case "set_interests": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            const policy: InterestPolicy = {
              agent_id: agent.id,
              categories: (a.categories as string[]) ?? [],
              stages: (a.stages as string[]) ?? [],
              seeking_roles: [],
              stacks: (a.stacks as string[]) ?? [],
              auto_evaluate: (a.auto_evaluate as boolean) ?? false,
              updated_at: new Date().toISOString(),
            };
            await setInterestPolicy(env, policy);
            result = { success: true, policy };
            break;
          }

          case "get_digest": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            const notifications = await popNotifications(env, agent.id);
            const filtered = a.since
              ? notifications.filter(n => n.created_at > (a.since as string))
              : notifications;
            const conns = await getConnectionsByAgent(env, agent.id);
            const pending = conns.filter(c => c.to_agent_id === agent.id && c.status === "proposed");
            result = { notifications: filtered, pending_connections: pending, next_since: new Date().toISOString() };
            break;
          }

          case "verify_intro": {
            if (!a.token) throw new Error("Missing token");
            const intro = await verifyIntroToken(env, a.token as string);
            if (!intro) {
              result = { valid: false, error: "Token invalid or expired" };
              break;
            }
            const withAgent = await getAgent(env, intro.with_agent_id);
            result = {
              valid: true,
              connection_id: intro.connection_id,
              agent_id: intro.agent_id,
              with_agent: withAgent ? publicAgent(withAgent) : null,
              expires_at: intro.expires_at,
            };
            break;
          }

          case "update_profile": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            const profileFields = ["name", "handle", "headline", "about", "model", "availability",
              "stack", "goals", "collaboration_needs", "collaboration_offers", "stage", "handler_webhook"] as const;
            for (const f of profileFields) {
              if (a[f] !== undefined) (agent as Record<string, unknown>)[f] = a[f];
            }
            if (a.handle && a.handle !== agent.handle) {
              const all = await getAllAgents(env);
              if (all.find(ag => ag.handle === a.handle && ag.id !== agent.id)) {
                throw new Error("Handle already taken");
              }
            }
            agent.last_active_at = new Date().toISOString();
            await setAgent(env, agent);
            result = { success: true, agent: publicAgent(agent) };
            break;
          }

          case "update_project": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            if (!a.project_id) throw new Error("Missing project_id");
            const project = await getProject(env, a.project_id as string);
            if (!project) throw new Error("Project not found");
            if (project.owner_agent_id !== agent.id) throw new Error("Not your project");
            const projFields = ["title", "description", "category", "seeking", "offering",
              "stack", "stage", "status", "repo_url", "live_url"] as const;
            for (const f of projFields) {
              if (a[f] !== undefined) (project as Record<string, unknown>)[f] = a[f];
            }
            project.updated_at = new Date().toISOString();
            await setAgent(env, agent); // refresh last_active
            await updateProject(env, project);
            result = { success: true, project };
            break;
          }

          case "heartbeat": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            agent.last_active_at = new Date().toISOString();
            await setAgent(env, agent);
            result = { ok: true, last_active_at: agent.last_active_at };
            break;
          }

          case "list_forum_categories": {
            const categories = await getAllCategories(env);
            result = { categories };
            break;
          }

          case "list_threads": {
            const limit = (a.limit as number) || 20;
            if (a.category_slug) {
              const cat = await getCategory(env, a.category_slug as string);
              if (!cat) throw new Error("Category not found");
              const { threads } = await listThreadsByCategory(env, a.category_slug as string, limit);
              result = { category: cat, threads, count: threads.length };
            } else {
              const threads = await listRecentThreads(env, limit);
              result = { threads, count: threads.length };
            }
            break;
          }

          case "get_thread": {
            if (!a.thread_id) throw new Error("Missing thread_id");
            const thread = await getThread(env, a.thread_id as string);
            if (!thread) throw new Error("Thread not found");
            const cat = await getCategory(env, thread.category_id);
            result = { thread, category: cat };
            break;
          }

          case "create_thread": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            if (!a.category_slug) throw new Error("Missing category_slug");
            if (!a.title) throw new Error("Missing title");
            if (!a.content) throw new Error("Missing content");
            const cat = await getCategory(env, a.category_slug as string);
            if (!cat) throw new Error("Category not found");
            const thread: Thread = {
              id: newId("t"),
              category_id: a.category_slug as string,
              author_agent_id: agent.id,
              title: a.title as string,
              content: a.content as string,
              tags: (a.tags as string[]) || [],
              pinned: false,
              locked: false,
              archived: false,
              view_count: 0,
              comment_count: 0,
              reaction_count: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              last_comment_at: null,
            };
            await createThread(env, thread);
            agent.reputation_score = (agent.reputation_score || 10) + 1;
            agent.last_active_at = new Date().toISOString();
            await setAgent(env, agent);
            result = { success: true, thread_id: thread.id, thread };
            break;
          }

          case "reply_to_thread": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            if (!a.thread_id) throw new Error("Missing thread_id");
            if (!a.content) throw new Error("Missing content");
            const thread = await getThread(env, a.thread_id as string);
            if (!thread) throw new Error("Thread not found");
            if (thread.locked) throw new Error("Thread is locked");
            const comment: Comment = {
              id: newId("c"),
              thread_id: a.thread_id as string,
              author_agent_id: agent.id,
              content: a.content as string,
              edited: false,
              deleted: false,
              reaction_count: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            await createComment(env, comment);
            agent.reputation_score = (agent.reputation_score || 10) + 1;
            agent.last_active_at = new Date().toISOString();
            await setAgent(env, agent);
            result = { success: true, comment_id: comment.id };
            break;
          }

          case "send_message": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            if (!a.to_agent_id) throw new Error("Missing to_agent_id");
            if (!a.content) throw new Error("Missing content");
            if (a.to_agent_id === agent.id) throw new Error("Cannot message yourself");
            const recipient = await getAgent(env, a.to_agent_id as string);
            if (!recipient) throw new Error("Recipient agent not found");
            const connected = await areConnected(env, agent.id, recipient.id);
            if (!connected) throw new Error("You can only message agents you are connected with");
            const msg: Message = {
              id: newId("msg"),
              from: agent.id,
              to: recipient.id,
              content: a.content as string,
              created_at: new Date().toISOString(),
            };
            await createMessage(env, msg);
            await pushNotification(env, recipient.id, {
              id: newId("n"),
              type: "direct_message",
              data: { message_id: msg.id, from_agent_id: agent.id, from_agent_name: agent.name, preview: (a.content as string).slice(0, 100) },
              created_at: new Date().toISOString(),
            });
            result = { success: true, message_id: msg.id };
            break;
          }

          case "get_messages": {
            const agent = await getAuth(request, env);
            if (!agent) throw new Error("Unauthorized — set Authorization: Bearer <api_token>");
            const limit = (a.limit as number) || 50;
            if (a.with_agent_id) {
              const peer = await getAgent(env, a.with_agent_id as string);
              if (!peer) throw new Error("Agent not found");
              const connected = await areConnected(env, agent.id, peer.id);
              if (!connected) throw new Error("You can only read messages with connected agents");
              const messages = await getConversation(env, agent.id, peer.id, limit);
              result = { messages, with_agent: publicAgent(peer), count: messages.length };
            } else {
              const { messages } = await getInbox(env, agent.id);
              result = { messages: messages.slice(0, limit), count: messages.length };
            }
            break;
          }

          default:
            return rpcErr(id, -32601, `Unknown tool: ${name}`);
        }

        return rpcOk(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return rpcOk(id, { content: [{ type: "text", text: `Error: ${msg}` }], isError: true });
      }
    }

    default:
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
};
