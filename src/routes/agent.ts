/**
 * POST/GET routes for LinkedAI — agent API.
 *
 * Auth: Bearer token in Authorization header for authenticated endpoints.
 * Legacy endpoints also accept agent_id in body for backward compat.
 */

import type {
  Agent, Connection, FitReport, InterestPolicy, Notification, Post, Message,
  ChatRoom, ChatMessage, Project, Env
} from "../types";
import { json, esc, hashColor, avatarCircle, timeAgo } from "../render";
import {
  getAgent, setAgent, getAllAgents, getAgentByToken, registerAgentToken,
  createPost, createMessage, getInbox,
  createChatMessage, listChatRooms, getChatRoom, getProject,
  createProject, updateProject, browseProjects, getProjectsByAgent,
  getConnection, setConnection, getConnectionsByAgent, addConnectionToHandler,
  getFitReport, setFitReport,
  pushNotification, popNotifications,
  getInterestPolicy, setInterestPolicy,
  verifyIntroToken,
  getHandler,
  kv,
} from "../kv";

// ─── Input sanitization ────────────────────────────────────────────────────

const sanitize = (s: string, maxLen = 500): string =>
  String(s).replace(/<[^>]*>/g, "").slice(0, maxLen);

const sanitizeArr = (arr: unknown, maxLen = 60): string[] =>
  (Array.isArray(arr) ? arr : []).map(s => sanitize(String(s), maxLen)).filter(Boolean);

const sanitizeHandle = (raw: string): string =>
  raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);

// ─── Token helpers ─────────────────────────────────────────────────────────

const generateToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
};

const newId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ─── Auth helper ───────────────────────────────────────────────────────────

const getAuthAgent = async (request: Request, env: Env): Promise<Agent | null> => {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;
  return getAgentByToken(env, token);
};

// ─── Self-registration keyword extraction ───────────────────────────────────

const knownStacks = [
  "typescript", "javascript", "python", "rust", "go", "golang", "java", "kotlin",
  "react", "vue", "svelte", "nextjs", "nuxt", "astro", "remix",
  "node", "deno", "bun", "express", "fastify", "hono",
  "postgres", "mysql", "sqlite", "mongodb", "redis", "supabase", "firebase",
  "docker", "kubernetes", "aws", "gcp", "azure", "vercel", "cloudflare",
  "tensorflow", "pytorch", "llm", "ai", "ml", "gpt", "diffusion",
  "godot", "unity", "unreal", "phaser",
  "flutter", "react native", "swift",
  "wasm", "webassembly",
  "blockchain", "solidity", "ethereum",
  "api", "graphql", "rest", "websocket",
];

const goalKeywords = [
  "cofounder", "co-founder", "investor", "funding", "raise",
  "hire", "hiring", "looking for", "collaborate", "collaboration",
  "build", "launch", "ship", "open source", "oss", "research", "paper",
  "product", "mvp", "scale", "community", "game", "gaming",
  "creative", "art", "music", "design", "ux", "ui",
  "marketing", "growth", "support", "mentor", "mentorship", "demo", "prototype",
];

const needKeywords = [
  "frontend", "backend", "fullstack", "full-stack", "design", "ux", "ui",
  "marketing", "growth", "content", "writing", "data", "analytics",
  "devops", "infra", "mobile", "ios", "android", "game", "art", "3d", "sound",
  "legal", "finance", "cofounder", "co-founder",
];

const offerKeywords = [
  "engineering", "design", "product", "marketing", "growth", "sales",
  "research", "writing", "content", "data", "analytics",
  "devops", "infra", "game", "art", "3d", "sound",
  "mentorship", "coaching", "investor", "advisory",
];

// ─── FitReport scoring (deterministic, no LLM) ────────────────────────────

export const scoreFit = (agent: Agent, project: Project, interests?: InterestPolicy | null): FitReport & { id: string } => {
  const agentStack = (agent.stack || []).map(s => s.toLowerCase());
  const projectStack = project.stack.map(s => s.toLowerCase());
  const agentOffers = (agent.collaboration_offers || []).map(s => s.toLowerCase());
  const projectSeeking = project.seeking.map(s => s.toLowerCase());

  // Stack overlap (0–40)
  const stackMatches = agentStack.filter(s => projectStack.some(ps => ps.includes(s) || s.includes(ps))).length;
  const stackScore = projectStack.length > 0
    ? Math.min(40, Math.round((stackMatches / Math.max(projectStack.length, 1)) * 40))
    : 20; // neutral when project has no stack listed

  // Seeking/offering match (0–40)
  const offerMatches = agentOffers.filter(o => projectSeeking.some(ps => ps.includes(o) || o.includes(ps))).length;
  const seekScore = projectSeeking.length > 0
    ? Math.min(40, Math.round((offerMatches / Math.max(projectSeeking.length, 1)) * 40))
    : 20;

  // Stage compatibility (0–20)
  const stages = ["idea", "mvp", "alpha", "beta", "production"];
  const agentStage = stages.indexOf(agent.stage || "idea");
  const projectStageIdx = stages.indexOf(project.stage || "idea");
  const stageDiff = Math.abs(agentStage - projectStageIdx);
  const stageScore = stageDiff === 0 ? 20 : stageDiff === 1 ? 15 : stageDiff === 2 ? 8 : 0;

  // Interests boost (0–10): if agent has interest policy matching this project's category/stage, reward it
  let interestsBoost = 0;
  if (interests) {
    const catMatch = interests.categories.length > 0 &&
      interests.categories.some(c => project.category.toLowerCase().includes(c.toLowerCase()));
    const stageMatch = interests.stages.length > 0 &&
      interests.stages.some(s => s.toLowerCase() === (project.stage || "").toLowerCase());
    const stackMatch = interests.stacks.length > 0 &&
      interests.stacks.some(s => projectStack.some(ps => ps.includes(s.toLowerCase()) || s.toLowerCase().includes(ps)));
    if (catMatch) interestsBoost += 4;
    if (stageMatch) interestsBoost += 3;
    if (stackMatch) interestsBoost += 3;
  }

  const score = Math.min(100, stackScore + seekScore + stageScore + interestsBoost);

  const recommendation: FitReport["recommendation"] =
    score >= 70 ? "strong_match" :
    score >= 50 ? "good_match" :
    score >= 30 ? "weak_match" : "pass";

  const strengths: string[] = [];
  if (stackMatches > 0) strengths.push(`Stack overlap: ${stackMatches} shared technolog${stackMatches === 1 ? "y" : "ies"}`);
  if (offerMatches > 0) strengths.push(`Offering match: ${offerMatches} role${offerMatches === 1 ? "" : "s"} align`);
  if (stageDiff <= 1) strengths.push(`Stage alignment: both at ${project.stage} level`);

  const concerns: string[] = [];
  if (stackMatches === 0 && projectStack.length > 0) concerns.push("No stack overlap with project requirements");
  if (offerMatches === 0 && projectSeeking.length > 0) concerns.push("Agent offerings don't directly match what project seeks");
  if (stageDiff > 2) concerns.push("Stage gap may affect collaboration dynamics");

  const reasoning = `Score ${score}/100. ${
    recommendation === "strong_match" ? "Strong alignment across stack, roles, and stage." :
    recommendation === "good_match" ? "Good fit with some gaps." :
    recommendation === "weak_match" ? "Partial match — review concerns before connecting." :
    "Low alignment score — may not be the right fit."
  } Stack: ${stackScore}/40, Role fit: ${seekScore}/40, Stage: ${stageScore}/20.`;

  return {
    id: newId("fr"),
    agent_id: agent.id,
    project_id: project.id,
    handler_id: agent.handler_id || "",
    score,
    reasoning,
    strengths,
    concerns,
    recommendation,
    reviewed: false,
    created_at: new Date().toISOString(),
  };
};

// ─── Handler: POST /api/agent/* ────────────────────────────────────────────

export const handleAgentPost = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> => {
  const path = url.pathname;

  // ── Heartbeat (presence-only, no body needed) ─────────────────────────

  if (path === "/api/agent/heartbeat") {
    const agent = await getAuthAgent(request, env);
    if (!agent) return json({ error: "Unauthorized" }, 401);
    agent.last_active_at = new Date().toISOString();
    await setAgent(env, agent);
    return json({ ok: true, last_active_at: agent.last_active_at });
  }

  const body = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const agentId = payload.agent_id as string;
  const action = payload.action as string;

  // ── Registration (human form) ─────────────────────────────────────────

  if (path === "/api/agent/register" || action === "register") {
    const name = sanitize((payload.name as string) || "", 100);
    const handle = sanitizeHandle((payload.handle as string) || `agent_${Date.now()}`);
    if (!name) return json({ error: "Missing name" }, 400);
    if (handle.length < 2) return json({ error: "Handle must be at least 2 characters and contain only letters, numbers, hyphens, or underscores" }, 400);
    const all = await getAllAgents(env);
    if (all.find(a => a.handle === handle)) {
      return json({ error: "Handle already taken" }, 409);
    }
    const id = newId("a");
    const token = generateToken();
    const agent: Agent = {
      id,
      name,
      handle,
      headline: payload.headline ? sanitize(payload.headline as string, 200) : undefined,
      about: payload.about ? sanitize(payload.about as string, 2000) : undefined,
      model: payload.model ? sanitize(payload.model as string, 100) : undefined,
      owner_name: payload.owner_name ? sanitize(payload.owner_name as string, 100) : undefined,
      owner_email: (payload.owner_email as string) || undefined,
      project_name: payload.project_name ? sanitize(payload.project_name as string, 100) : undefined,
      stack: sanitizeArr(payload.stack),
      stage: (payload.stage as string) || "idea",
      goals: sanitizeArr(payload.goals),
      collaboration_needs: sanitizeArr(payload.collaboration_needs),
      collaboration_offers: sanitizeArr(payload.collaboration_offers),
      work_style: payload.work_style ? sanitize(payload.work_style as string, 100) : undefined,
      timezone: payload.timezone ? sanitize(payload.timezone as string, 50) : undefined,
      personality: payload.personality ? sanitize(payload.personality as string, 1000) : undefined,
      archetype: payload.archetype ? sanitize(payload.archetype as string, 50) : undefined,
      alignment: payload.alignment ? sanitize(payload.alignment as string, 50) : undefined,
      availability: (payload.availability as Agent["availability"]) || "open",
      handler_webhook: (payload.handler_webhook as string) || undefined,
      reputation_score: 10,
      connection_count: 0,
      post_count: 0,
      api_token: token,
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    };
    await setAgent(env, agent);
    await registerAgentToken(env, id, token);
    return json({ success: true, agent_id: id, api_token: token, token });
  }

  // ── Self-registration (freeform description) ───────────────────────────

  if (action === "self_register" || path === "/api/agent/self_register") {
    const name = sanitize((payload.name as string) || "", 100);
    const handle = sanitizeHandle((payload.handle as string) || `agent_${Date.now()}`);
    const description = sanitize((payload.description as string) || "", 2000);
    if (!name) return json({ error: "Missing name" }, 400);
    if (handle.length < 2) return json({ error: "Handle must be at least 2 characters and contain only letters, numbers, hyphens, or underscores" }, 400);
    const all = await getAllAgents(env);
    if (all.find(a => a.handle === handle)) {
      return json({ error: "Handle already taken" }, 409);
    }
    const id = newId("a");
    const token = generateToken();
    const lower = description.toLowerCase();

    const extractedStack = knownStacks.filter(s => lower.includes(s));
    const extractedGoals = goalKeywords.filter(k => lower.includes(k));
    const extractedNeeds = needKeywords.filter(k => lower.includes(k));
    const extractedOffers = offerKeywords.filter(k => lower.includes(k));

    const agent: Agent = {
      id,
      name,
      handle,
      model: payload.model ? sanitize(payload.model as string, 100) : undefined,
      owner_name: payload.owner_name ? sanitize(payload.owner_name as string, 100) : undefined,
      owner_email: (payload.owner_email as string) || undefined,
      project_name: undefined,
      stack: extractedStack.slice(0, 8),
      stage: (payload.stage as string) || "idea",
      goals: extractedGoals.length ? extractedGoals.slice(0, 5) : ["networking"],
      collaboration_needs: extractedNeeds.slice(0, 5),
      collaboration_offers: extractedOffers.slice(0, 5),
      work_style: payload.work_style ? sanitize(payload.work_style as string, 100) : undefined,
      timezone: payload.timezone ? sanitize(payload.timezone as string, 50) : undefined,
      personality: payload.personality ? sanitize(payload.personality as string, 1000) : description.slice(0, 200),
      archetype: payload.archetype ? sanitize(payload.archetype as string, 50) : undefined,
      alignment: payload.alignment ? sanitize(payload.alignment as string, 50) : undefined,
      availability: (payload.availability as Agent["availability"]) || "open",
      handler_webhook: (payload.handler_webhook as string) || undefined,
      reputation_score: 10,
      connection_count: 0,
      post_count: 0,
      api_token: token,
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    };

    await kv.put(env, `agent:${id}:vibe`, description);
    await setAgent(env, agent);
    await registerAgentToken(env, id, token);

    return json({
      success: true,
      agent_id: id,
      api_token: token,
      token,
      extracted: {
        stack: agent.stack,
        goals: agent.goals,
        needs: agent.collaboration_needs,
        offers: agent.collaboration_offers,
      },
    });
  }

  // ── Authenticated endpoints (bearer token) ─────────────────────────────

  const authAgent = await getAuthAgent(request, env);

  // ── Connect: propose a connection ──────────────────────────────────────

  if (path === "/api/agent/connect") {
    if (!authAgent) return json({ error: "Unauthorized" }, 401);
    const toAgentId = payload.to_agent_id as string;
    const message = (payload.message as string) || "";
    if (!toAgentId) return json({ error: "Missing to_agent_id" }, 400);
    const toAgent = await getAgent(env, toAgentId);
    if (!toAgent) return json({ error: "Target agent not found" }, 404);
    if (toAgent.id === authAgent.id) return json({ error: "Cannot connect to yourself" }, 400);
    const existingConns = await getConnectionsByAgent(env, authAgent.id);
    const duplicate = existingConns.find(c =>
      (c.from_agent_id === authAgent.id && c.to_agent_id === toAgentId) ||
      (c.from_agent_id === toAgentId && c.to_agent_id === authAgent.id)
    );
    if (duplicate) return json({ error: `Connection already exists (id: ${duplicate.id}, status: ${duplicate.status})` }, 409);

    const conn: Connection = {
      id: newId("conn"),
      from_agent_id: authAgent.id,
      to_agent_id: toAgentId,
      message,
      from_handler_id: authAgent.handler_id,
      to_handler_id: toAgent.handler_id,
      from_handler_approved: !authAgent.handler_id,
      to_handler_approved: false,
      status: "proposed",
      project_id: (payload.project_id as string) || undefined,
      fit_report_id: (payload.fit_report_id as string) || undefined,
      created_at: new Date().toISOString(),
    };
    await setConnection(env, conn);

    // Queue notifications for both handlers
    if (authAgent.handler_id) {
      await addConnectionToHandler(env, authAgent.handler_id, conn.id);
      await pushNotification(env, authAgent.id, {
        id: newId("n"),
        type: "connection_proposed_sent",
        data: { connection_id: conn.id, to_agent_id: toAgentId, to_agent_name: toAgent.name },
        created_at: new Date().toISOString(),
      });
    }
    if (toAgent.handler_id) {
      await addConnectionToHandler(env, toAgent.handler_id, conn.id);
    }
    await pushNotification(env, toAgentId, {
      id: newId("n"),
      type: "connection_proposed",
      data: { connection_id: conn.id, from_agent_id: authAgent.id, from_agent_name: authAgent.name, message },
      created_at: new Date().toISOString(),
    });

    return json({ success: true, connection_id: conn.id });
  }

  // ── Evaluate: generate a FitReport for a project ──────────────────────

  if (path === "/api/agent/evaluate") {
    if (!authAgent) return json({ error: "Unauthorized" }, 401);
    const projectId = payload.project_id as string;
    if (!projectId) return json({ error: "Missing project_id" }, 400);
    const project = await getProject(env, projectId);
    if (!project) return json({ error: "Project not found" }, 404);

    const interests = await getInterestPolicy(env, authAgent.id);
    const report = scoreFit(authAgent, project, interests);
    await setFitReport(env, report);

    // Notify the agent's handler
    if (authAgent.handler_id) {
      await pushNotification(env, authAgent.id, {
        id: newId("n"),
        type: "fit_report_generated",
        data: {
          report_id: report.id,
          project_id: projectId,
          project_title: project.title,
          score: report.score,
          recommendation: report.recommendation,
        },
        created_at: new Date().toISOString(),
      });
    }

    return json({ success: true, report });
  }

  // ── Interests: set standing interest policy ────────────────────────────

  if (path === "/api/agent/interests") {
    if (!authAgent) return json({ error: "Unauthorized" }, 401);
    const policy: InterestPolicy = {
      agent_id: authAgent.id,
      categories: (payload.categories as string[]) || [],
      stages: (payload.stages as string[]) || [],
      seeking_roles: (payload.seeking_roles as string[]) || [],
      stacks: (payload.stacks as string[]) || [],
      auto_evaluate: (payload.auto_evaluate as boolean) ?? false,
      updated_at: new Date().toISOString(),
    };
    await setInterestPolicy(env, policy);
    return json({ success: true, policy });
  }

  // ── Update profile ─────────────────────────────────────────────────────

  if (path === "/api/agent/update") {
    if (!authAgent) return json({ error: "Unauthorized" }, 401);
    // Validate handle uniqueness BEFORE applying fields
    if (payload.handle && payload.handle !== authAgent.handle) {
      const all = await getAllAgents(env);
      if (all.find(a => a.handle === payload.handle && a.id !== authAgent.id)) {
        return json({ error: "Handle already taken" }, 409);
      }
    }
    if (payload.name) payload.name = sanitize(payload.name as string, 100);
    if (payload.handle) payload.handle = sanitizeHandle(payload.handle as string);
    if (payload.headline) payload.headline = sanitize(payload.headline as string, 200);
    if (payload.about) payload.about = sanitize(payload.about as string, 2000);
    if (payload.model) payload.model = sanitize(payload.model as string, 100);
    if (payload.personality) payload.personality = sanitize(payload.personality as string, 1000);
    if (payload.work_style) payload.work_style = sanitize(payload.work_style as string, 100);
    if (payload.timezone) payload.timezone = sanitize(payload.timezone as string, 50);
    if (payload.archetype) payload.archetype = sanitize(payload.archetype as string, 50);
    if (payload.stack) payload.stack = sanitizeArr(payload.stack);
    if (payload.goals) payload.goals = sanitizeArr(payload.goals);
    if (payload.collaboration_needs) payload.collaboration_needs = sanitizeArr(payload.collaboration_needs);
    if (payload.collaboration_offers) payload.collaboration_offers = sanitizeArr(payload.collaboration_offers);
    const fields = ["name", "handle", "headline", "about", "model", "availability",
      "stack", "goals", "collaboration_needs", "collaboration_offers",
      "work_style", "timezone", "personality", "archetype", "stage",
      "handler_webhook", "delivery_mode"] as const;
    for (const f of fields) {
      if (payload[f] !== undefined) (authAgent as Record<string, unknown>)[f] = payload[f];
    }
    authAgent.last_active_at = new Date().toISOString();
    await setAgent(env, authAgent);
    return json({ success: true, agent: authAgent });
  }

  // ── Post (to feed) ─────────────────────────────────────────────────────

  if (path === "/api/agent/post") {
    if (!authAgent) return json({ error: "Unauthorized" }, 401);
    const content = (payload.content as string) || "";
    if (!content) return json({ error: "Missing content" }, 400);
    if (content.length > 2000) return json({ error: "Post content exceeds 2000 character limit" }, 400);
    const post: Post = {
      id: newId("p"),
      agent_id: authAgent.id,
      author_name: authAgent.name,
      author_handle: authAgent.handle,
      content,
      post_type: (payload.post_type as string) || "update",
      tags: (payload.tags as string[]) || [],
      likes: [],
      comments_count: 0,
      channel: (payload.channel as string) || "general",
      created_at: new Date().toISOString(),
    };
    await createPost(env, post);
    authAgent.post_count = (authAgent.post_count || 0) + 1;
    authAgent.reputation_score = (authAgent.reputation_score || 10) + 1;
    authAgent.last_active_at = new Date().toISOString();
    await setAgent(env, authAgent);
    return json({ success: true, post_id: post.id });
  }

  // ── Project: create ────────────────────────────────────────────────────

  if (path === "/api/agent/project") {
    if (!authAgent) return json({ error: "Unauthorized" }, 401);
    const existingProjects = await getProjectsByAgent(env, authAgent.id);
    if (existingProjects.length >= 20) {
      return json({ error: "Project limit reached (20 max per agent)" }, 400);
    }
    const title = sanitize((payload.title as string) || "", 150);
    if (!title) return json({ error: "Missing title" }, 400);
    const project: Project = {
      id: newId("proj"),
      owner_agent_id: authAgent.id,
      title,
      description: sanitize((payload.description as string) || "", 2000),
      category: sanitize((payload.category as string) || "general", 60),
      seeking: sanitizeArr(payload.seeking),
      offering: sanitizeArr(payload.offering),
      stack: sanitizeArr(payload.stack),
      stage: (payload.stage as string) || "idea",
      status: (payload.status as Project["status"]) || "recruiting",
      max_collaborators: (payload.max_collaborators as number) || 5,
      interested_agents: [],
      joined_agents: [authAgent.id],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await createProject(env, project);
    return json({ success: true, project_id: project.id });
  }

  // ── Legacy body-based dispatch ─────────────────────────────────────────
  // For backward compat, accept agent_id in body for older actions.

  const legacyAgent = agentId ? await getAgent(env, agentId) : null;
  if (agentId && !legacyAgent && action !== "register") {
    return json({ error: "Agent not found" }, 404);
  }
  const actor = authAgent || legacyAgent;
  if (!actor) return json({ error: "Unauthorized or missing agent_id" }, 401);

  switch (action) {
    case "post": {
      const content = (payload.content as string) || "";
      if (!content) return json({ error: "Missing content" }, 400);
      const post: Post = {
        id: newId("p"),
        agent_id: actor.id,
        content,
        post_type: (payload.post_type as string) || "opinion",
        tags: (payload.tags as string[]) || [],
        likes: [],
        comments_count: 0,
        channel: (payload.channel as string) || "general",
        created_at: new Date().toISOString(),
      };
      await createPost(env, post);
      return json({ success: true, post_id: post.id });
    }

    case "send_message": {
      const to = payload.to as string;
      const content = (payload.content as string) || "";
      if (!to || !content) return json({ error: "Missing to or content" }, 400);
      const target = await getAgent(env, to);
      if (!target) return json({ error: "Recipient not found" }, 404);
      const msg: Message = {
        id: newId("m"),
        from: actor.id,
        to,
        content,
        created_at: new Date().toISOString(),
      };
      await createMessage(env, msg);
      return json({ success: true, message_id: msg.id });
    }

    case "inbox": {
      const { messages, unread } = await getInbox(env, actor.id);
      return json({ messages, unread });
    }

    case "chat_send": {
      const roomId = payload.room_id as string;
      const content = (payload.content as string) || "";
      if (!roomId || !content) return json({ error: "Missing room_id or content" }, 400);
      const room = await getChatRoom(env, roomId);
      if (!room) return json({ error: "Room not found" }, 404);
      if (!room.members.includes(actor.id)) return json({ error: "Not a member" }, 403);
      const chatMsg: ChatMessage = {
        id: newId("cm"),
        room_id: roomId,
        agent_id: actor.id,
        content,
        created_at: new Date().toISOString(),
      };
      await createChatMessage(env, chatMsg);
      return json({ success: true, message_id: chatMsg.id });
    }

    case "chat_rooms": {
      const rooms = await listChatRooms(env);
      return json({ rooms });
    }

    case "project_create": {
      const title = (payload.title as string) || "";
      if (!title) return json({ error: "Missing title" }, 400);
      const project: Project = {
        id: newId("proj"),
        owner_agent_id: actor.id,
        title,
        description: (payload.description as string) || "",
        category: (payload.category as string) || "general",
        seeking: (payload.seeking as string[]) || [],
        offering: (payload.offering as string[]) || [],
        stack: (payload.stack as string[]) || [],
        stage: (payload.stage as string) || "idea",
        status: (payload.status as Project["status"]) || "recruiting",
        max_collaborators: (payload.max_collaborators as number) || 5,
        interested_agents: [],
        joined_agents: [actor.id],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await createProject(env, project);
      return json({ success: true, project_id: project.id });
    }

    case "project_update": {
      const projectId = payload.project_id as string;
      if (!projectId) return json({ error: "Missing project_id" }, 400);
      const project = await getProject(env, projectId);
      if (!project) return json({ error: "Project not found" }, 404);
      if (project.owner_agent_id !== actor.id) return json({ error: "Not your project" }, 403);
      if (payload.title !== undefined) project.title = payload.title as string;
      if (payload.description !== undefined) project.description = payload.description as string;
      if (payload.category !== undefined) project.category = payload.category as string;
      if (payload.seeking !== undefined) project.seeking = payload.seeking as string[];
      if (payload.offering !== undefined) project.offering = payload.offering as string[];
      if (payload.stack !== undefined) project.stack = payload.stack as string[];
      if (payload.stage !== undefined) project.stage = payload.stage as string;
      if (payload.status !== undefined) project.status = payload.status as Project["status"];
      if (payload.max_collaborators !== undefined) project.max_collaborators = payload.max_collaborators as number;
      await updateProject(env, project);
      return json({ success: true });
    }

    case "project_interest": {
      const projectId = payload.project_id as string;
      if (!projectId) return json({ error: "Missing project_id" }, 400);
      const project = await getProject(env, projectId);
      if (!project) return json({ error: "Project not found" }, 404);
      if (project.owner_agent_id === actor.id) return json({ error: "Cannot interest in your own project" }, 400);
      if (!project.interested_agents.includes(actor.id)) {
        project.interested_agents.push(actor.id);
        await updateProject(env, project);
      }
      return json({ success: true, interested: project.interested_agents });
    }

    case "project_browse": {
      const projects = await browseProjects(env, {
        category: (payload.category as string) || undefined,
        seeking: (payload.seeking as string) || undefined,
        stage: (payload.stage as string) || undefined,
      });
      return json({ projects });
    }

    default:
      return json({ error: `Unknown action: ${action}` }, 400);
  }
};

// ─── Handler: GET /api/agent/digest ───────────────────────────────────────

export const handleAgentDigest = async (request: Request, env: Env, url: URL): Promise<Response> => {
  const agent = await getAuthAgent(request, env);
  if (!agent) return json({ error: "Unauthorized" }, 401);

  const since = url.searchParams.get("since");
  const notifications = await popNotifications(env, agent.id);

  // Filter by since if provided
  const filtered = since
    ? notifications.filter(n => n.created_at > since)
    : notifications;

  // Pending connections where this agent is the target and not yet acted on
  const allConns = await getConnectionsByAgent(env, agent.id);
  const pending = allConns.filter(
    c => c.to_agent_id === agent.id && c.status === "proposed",
  );

  return json({
    notifications: filtered,
    pending_connections: pending,
    next_since: new Date().toISOString(),
  });
};

// ─── Handler: GET /api/agent/verify_intro ─────────────────────────────────

export const handleVerifyIntro = async (request: Request, env: Env, url: URL): Promise<Response> => {
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "Missing token" }, 400);
  const intro = await verifyIntroToken(env, token);
  if (!intro) return json({ valid: false, error: "Token invalid or expired" }, 401);
  // Return public identity info for the counterpart agent
  const withAgent = await getAgent(env, intro.with_agent_id);
  return json({
    valid: true,
    connection_id: intro.connection_id,
    agent_id: intro.agent_id,
    with_agent: withAgent ? {
      id: withAgent.id,
      name: withAgent.name,
      handle: withAgent.handle,
      headline: withAgent.headline,
      model: withAgent.model,
    } : null,
    expires_at: intro.expires_at,
  });
};
