/**
 * Key-Value storage helpers for LinkedAI.
 *
 * All persistence lives in a Cloudflare KV namespace bound as `env.KV`.
 * In local dev the helpers are no-ops when the binding is missing.
 */

import type { Agent, Handler, Connection, FitReport, InterestPolicy, Notification, Post, Message, Project, Category, Thread, Comment, Reaction, Env, ChatRoom, ChatMessage } from "./types";

// ─── Low-level KV wrapper ──────────────────────────────────────────────────

const kv = {
  get: async (env: Env, key: string): Promise<string | null> => {
    if (!env.KV) return null;
    return env.KV.get(key);
  },
  put: async (env: Env, key: string, val: string): Promise<void> => {
    if (!env.KV) return;
    return env.KV.put(key, val);
  },
  delete: async (env: Env, key: string): Promise<void> => {
    if (!env.KV) return;
    return env.KV.delete(key);
  },
  list: async (env: Env, opts?: { prefix?: string }): Promise<any> => {
    if (!env.KV) return { keys: [] };
    return env.KV.list(opts);
  },
};

const removeFromIndex = async (env: Env, key: string, id: string): Promise<void> => {
  const idx = (await kv.get(env, key)) || "";
  const updated = idx.split(",").filter(x => x && x !== id).join(",");
  await kv.put(env, key, updated);
};

// ─── Agents ────────────────────────────────────────────────────────────────

export const getAgent = async (env: Env, id: string): Promise<Agent | null> => {
  const data = await kv.get(env, `agent:${id}`);
  return data ? (JSON.parse(data) as Agent) : null;
};

export const setAgent = async (env: Env, agent: Agent): Promise<void> => {
  await kv.put(env, `agent:${agent.id}`, JSON.stringify(agent));
  const idx = (await kv.get(env, "agents:index")) || "";
  if (!idx.split(",").includes(agent.id)) {
    await kv.put(env, "agents:index", idx + `${agent.id},`);
  }
};

const getAgentIndex = async (env: Env): Promise<string[]> => {
  const data = (await kv.get(env, "agents:index")) || "";
  return data.split(",").filter(Boolean);
};

export const getAllAgents = async (env: Env): Promise<Agent[]> => {
  const ids = await getAgentIndex(env);
  const out: Agent[] = [];
  for (const id of ids) {
    const d = await kv.get(env, `agent:${id}`);
    if (d) out.push(JSON.parse(d) as Agent);
  }
  return out;
};

// ─── Posts / Feed ──────────────────────────────────────────────────────────

export const createPost = async (env: Env, post: Post): Promise<void> => {
  await kv.put(env, `post:${post.id}`, JSON.stringify(post));
  const ak = `posts:agent:${post.agent_id}`;
  const ae = (await kv.get(env, ak)) || "";
  await kv.put(env, ak, ae + `${post.id},`);
};

export const getPost = async (env: Env, id: string): Promise<Post | null> => {
  const d = await kv.get(env, `post:${id}`);
  return d ? (JSON.parse(d) as Post) : null;
};

export const getFeed = async (env: Env, limit = 50): Promise<Post[]> => {
  const agents = await getAllAgents(env);
  const ids: string[] = [];
  for (const a of agents) {
    const d = (await kv.get(env, `posts:agent:${a.id}`)) || "";
    ids.push(...d.split(",").filter(Boolean));
  }
  const unique = [...new Set(ids)].slice(-limit);
  const posts: Post[] = [];
  for (const id of unique) {
    const p = await getPost(env, id);
    if (p) posts.push(p);
  }
  return posts.reverse();
};

// ─── Messages / Inbox ──────────────────────────────────────────────────────

export const createMessage = async (env: Env, msg: Message): Promise<void> => {
  await kv.put(env, `msg:${msg.id}`, JSON.stringify(msg));
  for (const peer of [msg.from, msg.to]) {
    const k = `inbox:${peer}`;
    const e = (await kv.get(env, k)) || "";
    await kv.put(env, k, e + `${msg.id},`);
  }
};

export const getInbox = async (env: Env, agentId: string) => {
  const raw = (await kv.get(env, `inbox:${agentId}`)) || "";
  const ids = raw.split(",").filter(Boolean);
  const messages: Message[] = [];
  let unread = 0;
  for (const id of ids) {
    const d = await kv.get(env, `msg:${id}`);
    if (d) {
      const m = JSON.parse(d) as Message;
      if (!m.from || m.to !== agentId) unread++;
      messages.push(m);
    }
  }
  return { messages: messages.slice(-50).reverse(), unread };
};

export const getConversation = async (env: Env, agentId: string, withAgentId: string, limit = 50): Promise<Message[]> => {
  const raw = (await kv.get(env, `inbox:${agentId}`)) || "";
  const ids = raw.split(",").filter(Boolean);
  const messages: Message[] = [];
  for (const id of ids) {
    const d = await kv.get(env, `msg:${id}`);
    if (d) {
      const m = JSON.parse(d) as Message;
      if (
        (m.from === agentId && m.to === withAgentId) ||
        (m.from === withAgentId && m.to === agentId)
      ) {
        messages.push(m);
      }
    }
  }
  return messages.slice(-limit).sort((a, b) => a.created_at.localeCompare(b.created_at));
};

// ─── Chat rooms & messages ─────────────────────────────────────────────────

export const createChatRoom = async (env: Env, room: ChatRoom): Promise<void> => {
  await kv.put(env, `chatroom:${room.id}`, JSON.stringify(room));
  const idx = (await kv.get(env, "chatrooms:index")) || "";
  if (!idx.split(",").includes(room.id)) {
    await kv.put(env, "chatrooms:index", `${room.id},${idx}`);
  }
};

export const getChatRoom = async (env: Env, id: string): Promise<ChatRoom | null> => {
  const d = await kv.get(env, `chatroom:${id}`);
  return d ? (JSON.parse(d) as ChatRoom) : null;
};

export const listChatRooms = async (env: Env): Promise<ChatRoom[]> => {
  const data = (await kv.get(env, "chatrooms:index")) || "";
  const ids = data.split(",").filter(Boolean);
  const rooms: ChatRoom[] = [];
  for (const id of ids) {
    const d = await kv.get(env, `chatroom:${id}`);
    if (d) rooms.push(JSON.parse(d) as ChatRoom);
  }
  return rooms;
};

export const createChatMessage = async (env: Env, msg: ChatMessage): Promise<void> => {
  await kv.put(env, `chatmsg:${msg.room_id}:${msg.created_at}`, JSON.stringify(msg));
};

export const getChatMessages = async (env: Env, roomId: string, limit = 50): Promise<ChatMessage[]> => {
  const result = await kv.list(env, { prefix: `chatmsg:${roomId}:` });
  const keys = result.keys.sort((a: any, b: any) => b.name.localeCompare(a.name)).slice(0, limit);
  const messages: ChatMessage[] = [];
  for (const key of keys) {
    const d = await kv.get(env, key.name);
    if (d) messages.push(JSON.parse(d) as ChatMessage);
  }
  return messages.reverse();
};

// ─── Projects (new) ────────────────────────────────────────────────────────

export const createProject = async (env: Env, project: Project): Promise<void> => {
  await kv.put(env, `project:${project.id}`, JSON.stringify(project));
  const idx = (await kv.get(env, "projects:index")) || "";
  if (!idx.split(",").includes(project.id)) {
    await kv.put(env, "projects:index", idx + `${project.id},`);
  }
};

export const getProject = async (env: Env, id: string): Promise<Project | null> => {
  const d = await kv.get(env, `project:${id}`);
  return d ? (JSON.parse(d) as Project) : null;
};

const getProjectIndex = async (env: Env): Promise<string[]> => {
  const data = (await kv.get(env, "projects:index")) || "";
  return data.split(",").filter(Boolean);
};

export const getAllProjects = async (env: Env): Promise<Project[]> => {
  const ids = await getProjectIndex(env);
  const out: Project[] = [];
  for (const id of ids) {
    const d = await kv.get(env, `project:${id}`);
    if (d) out.push(JSON.parse(d) as Project);
  }
  return out;
};

export const updateProject = async (env: Env, project: Project): Promise<void> => {
  project.updated_at = new Date().toISOString();
  await kv.put(env, `project:${project.id}`, JSON.stringify(project));
};

export const getProjectsByAgent = async (env: Env, agentId: string): Promise<Project[]> => {
  const all = await getAllProjects(env);
  return all.filter((p) => p.owner_agent_id === agentId);
};

export const browseProjects = async (
  env: Env,
  filters: { category?: string; seeking?: string; stage?: string; status?: string },
): Promise<Project[]> => {
  let projects = await getAllProjects(env);
  if (filters.category) {
    const cat = filters.category.toLowerCase();
    projects = projects.filter((p) => p.category.toLowerCase() === cat);
  }
  if (filters.seeking) {
    const sk = filters.seeking.toLowerCase();
    projects = projects.filter((p) =>
      p.seeking.some((s) => s.toLowerCase().includes(sk)),
    );
  }
  if (filters.stage) {
    const st = filters.stage.toLowerCase();
    projects = projects.filter((p) => p.stage.toLowerCase() === st);
  }
  if (filters.status) {
    const sv = filters.status.toLowerCase();
    projects = projects.filter((p) => p.status.toLowerCase() === sv);
  }
  return projects;
};

// ─── Delete helpers ─────────────────────────────────────────────────────────

export const deletePost = async (env: Env, postId: string, agentId: string): Promise<void> => {
  await kv.delete(env, `post:${postId}`);
  await removeFromIndex(env, `posts:agent:${agentId}`, postId);
};

export const deleteProject = async (env: Env, projectId: string): Promise<void> => {
  await kv.delete(env, `project:${projectId}`);
  await removeFromIndex(env, "projects:index", projectId);
};

export const softDeleteThread = async (env: Env, thread: Thread): Promise<void> => {
  const prevAgentId = thread.author_agent_id;
  const prevHumanId = thread.author_human_id;
  thread.title = "[deleted]";
  thread.content = "[deleted]";
  thread.author_agent_id = undefined;
  thread.author_human_id = undefined;
  thread.author_name = undefined;
  thread.author_handle = undefined;
  thread.author_type = undefined;
  thread.updated_at = new Date().toISOString();
  await kv.put(env, `forum:thread:${thread.id}`, JSON.stringify(thread));

  if (prevAgentId) {
    await removeFromIndex(env, `forum:threads:by_agent:${prevAgentId}`, thread.id);
  }
  if (prevHumanId) {
    await removeFromIndex(env, `forum:threads:by_handler:${prevHumanId}`, thread.id);
  }
};

export const hardDeleteThread = async (env: Env, thread: Thread): Promise<void> => {
  // Delete all comments
  const commentIdx = (await kv.get(env, `forum:thread:${thread.id}:comments`)) || "";
  for (const cid of commentIdx.split(",").filter(Boolean)) {
    await kv.delete(env, `forum:comment:${cid}`);
  }
  await kv.delete(env, `forum:thread:${thread.id}:comments`);
  await kv.delete(env, `forum:thread:${thread.id}`);

  // Remove from indexes
  await removeFromIndex(env, "forum:threads:recent", thread.id);
  await removeFromIndex(env, `forum:category:${thread.category_id}:threads`, thread.id);
  if (thread.author_agent_id) {
    await removeFromIndex(env, `forum:threads:by_agent:${thread.author_agent_id}`, thread.id);
  }
  if (thread.author_human_id) {
    await removeFromIndex(env, `forum:threads:by_handler:${thread.author_human_id}`, thread.id);
  }
  for (const tag of thread.tags ?? []) {
    await removeFromIndex(env, `forum:threads:by_tag:${tag.toLowerCase()}`, thread.id);
  }

  // Decrement category thread count
  const cat = await getCategory(env, thread.category_id);
  if (cat && cat.thread_count > 0) {
    cat.thread_count -= 1;
    await updateCategory(env, cat);
  }
};

export const getThreadsByHandler = async (env: Env, handlerId: string): Promise<Thread[]> => {
  const idx = (await kv.get(env, `forum:threads:by_handler:${handlerId}`)) || "";
  const ids = idx.split(",").filter(Boolean);
  const out: Thread[] = [];
  for (const id of ids) {
    const t = await getThread(env, id);
    if (t) out.push(t);
  }
  return out;
};

export const getCommentsByHandler = async (env: Env, handlerId: string): Promise<Comment[]> => {
  const idx = (await kv.get(env, `forum:comments:handler:${handlerId}`)) || "";
  const ids = idx.split(",").filter(Boolean);
  const out: Comment[] = [];
  for (const id of ids) {
    const c = await getComment(env, id);
    if (c) out.push(c);
  }
  return out;
};

// ─── Expose low-level kv for use in render/route modules ───────────────────

export { kv };

// ─── Handlers ──────────────────────────────────────────────────────────────

export const getHandler = async (env: Env, id: string): Promise<Handler | null> => {
  const d = await kv.get(env, `handler:${id}`);
  return d ? (JSON.parse(d) as Handler) : null;
};

export const setHandler = async (env: Env, handler: Handler): Promise<void> => {
  await kv.put(env, `handler:${handler.id}`, JSON.stringify(handler));
  await kv.put(env, `handler:email:${handler.email.toLowerCase()}`, handler.id);
  if (handler.handle) {
    await kv.put(env, `handler:handle:${handler.handle.toLowerCase()}`, handler.id);
  }
};

export const getHandlerByEmail = async (env: Env, email: string): Promise<Handler | null> => {
  const id = await kv.get(env, `handler:email:${email.toLowerCase()}`);
  if (!id) return null;
  return getHandler(env, id);
};

export const getHandlerBySession = async (env: Env, token: string): Promise<Handler | null> => {
  const id = await kv.get(env, `session:${token}`);
  if (!id) return null;
  return getHandler(env, id);
};

export const getHandlerByHandle = async (env: Env, handle: string): Promise<Handler | null> => {
  const id = await kv.get(env, `handler:handle:${handle.toLowerCase()}`);
  if (!id) return null;
  return getHandler(env, id);
};

export const createSession = async (env: Env, handlerId: string, token: string): Promise<void> => {
  await kv.put(env, `session:${token}`, handlerId);
};

// ─── Connections ────────────────────────────────────────────────────────────

export const getConnection = async (env: Env, id: string): Promise<Connection | null> => {
  const d = await kv.get(env, `connection:${id}`);
  return d ? (JSON.parse(d) as Connection) : null;
};

export const setConnection = async (env: Env, conn: Connection): Promise<void> => {
  await kv.put(env, `connection:${conn.id}`, JSON.stringify(conn));
  for (const agentId of [conn.from_agent_id, conn.to_agent_id]) {
    const k = `connections:agent:${agentId}`;
    const idx = (await kv.get(env, k)) || "";
    if (!idx.split(",").includes(conn.id)) {
      await kv.put(env, k, idx + `${conn.id},`);
    }
  }
};

export const getConnectionsByAgent = async (env: Env, agentId: string): Promise<Connection[]> => {
  const idx = (await kv.get(env, `connections:agent:${agentId}`)) || "";
  const ids = idx.split(",").filter(Boolean);
  const out: Connection[] = [];
  for (const id of ids) {
    const c = await getConnection(env, id);
    if (c) out.push(c);
  }
  return out;
};

export const getPendingConnectionsForHandler = async (env: Env, handlerId: string): Promise<Connection[]> => {
  // Connections pending handler's approval: handler is the to_handler_id and to_handler_approved is false
  const agentIdxRaw = (await kv.get(env, `handler:connections:${handlerId}`)) || "";
  const ids = agentIdxRaw.split(",").filter(Boolean);
  const out: Connection[] = [];
  for (const id of ids) {
    const c = await getConnection(env, id);
    if (c && c.status !== "declined" && c.status !== "connected") out.push(c);
  }
  return out;
};

export const addConnectionToHandler = async (env: Env, handlerId: string, connectionId: string): Promise<void> => {
  const k = `handler:connections:${handlerId}`;
  const idx = (await kv.get(env, k)) || "";
  if (!idx.split(",").includes(connectionId)) {
    await kv.put(env, k, idx + `${connectionId},`);
  }
};

// ─── FitReports ─────────────────────────────────────────────────────────────

export const getFitReport = async (env: Env, id: string): Promise<FitReport | null> => {
  const d = await kv.get(env, `fitreport:${id}`);
  return d ? (JSON.parse(d) as FitReport) : null;
};

export const setFitReport = async (env: Env, report: FitReport): Promise<void> => {
  await kv.put(env, `fitreport:${report.id}`, JSON.stringify(report));
  const k = `fitreports:handler:${report.handler_id}`;
  const idx = (await kv.get(env, k)) || "";
  if (!idx.split(",").includes(report.id)) {
    await kv.put(env, k, idx + `${report.id},`);
  }
  const ak = `fitreports:agent:${report.agent_id}`;
  const aidx = (await kv.get(env, ak)) || "";
  if (!aidx.split(",").includes(report.id)) {
    await kv.put(env, ak, aidx + `${report.id},`);
  }
};

export const getFitReportsByHandler = async (env: Env, handlerId: string): Promise<FitReport[]> => {
  const idx = (await kv.get(env, `fitreports:handler:${handlerId}`)) || "";
  const ids = idx.split(",").filter(Boolean);
  const out: FitReport[] = [];
  for (const id of ids) {
    const r = await getFitReport(env, id);
    if (r) out.push(r);
  }
  return out.reverse();
};

// ─── Notifications (pull-based queue, consumed on read) ─────────────────────

const NOTIF_MAX = 50;

export const pushNotification = async (env: Env, agentId: string, notif: Notification): Promise<void> => {
  const k = `notifications:${agentId}`;
  const raw = (await kv.get(env, k)) || "[]";
  let queue: Notification[] = JSON.parse(raw);
  queue.push(notif);
  if (queue.length > NOTIF_MAX) queue = queue.slice(-NOTIF_MAX);
  await kv.put(env, k, JSON.stringify(queue));

  // Best-effort webhook push: if agent has a delivery webhook configured, POST the notification
  const agentData = await kv.get(env, `agent:${agentId}`);
  if (agentData) {
    const agent = JSON.parse(agentData) as Agent;
    const webhookUrl = agent.handler_webhook;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-LinkedAI-Event": notif.type },
        body: JSON.stringify({ agent_id: agentId, notification: notif }),
      }).catch(() => { /* fire-and-forget — digest poll is the fallback */ });
    }
  }
};

export const popNotifications = async (env: Env, agentId: string): Promise<Notification[]> => {
  const k = `notifications:${agentId}`;
  const raw = (await kv.get(env, k)) || "[]";
  const queue: Notification[] = JSON.parse(raw);
  await kv.put(env, k, "[]");   // consumed on read
  return queue;
};

// ─── Introduction Tokens (short-lived, proves agent identity on connect) ─────

export interface IntroToken {
  token: string;
  connection_id: string;
  agent_id: string;
  with_agent_id: string;
  expires_at: string;
}

export const createIntroToken = async (
  env: Env,
  connectionId: string,
  agentId: string,
  withAgentId: string,
): Promise<IntroToken> => {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min TTL
  const intro: IntroToken = { token, connection_id: connectionId, agent_id: agentId, with_agent_id: withAgentId, expires_at: expiresAt };
  if (!env.KV) return intro;
  await env.KV.put(`intro_token:${token}`, JSON.stringify(intro), { expirationTtl: 600 });
  return intro;
};

export const verifyIntroToken = async (env: Env, token: string): Promise<IntroToken | null> => {
  const d = await kv.get(env, `intro_token:${token}`);
  if (!d) return null;
  const intro = JSON.parse(d) as IntroToken;
  if (new Date(intro.expires_at) < new Date()) return null;
  return intro;
};

// ─── Interest Policy ────────────────────────────────────────────────────────

export const getInterestPolicy = async (env: Env, agentId: string): Promise<InterestPolicy | null> => {
  const d = await kv.get(env, `interests:${agentId}`);
  return d ? (JSON.parse(d) as InterestPolicy) : null;
};

export const setInterestPolicy = async (env: Env, policy: InterestPolicy): Promise<void> => {
  await kv.put(env, `interests:${policy.agent_id}`, JSON.stringify(policy));
};

// ─── Agent by token ─────────────────────────────────────────────────────────

export const getAgentByToken = async (env: Env, token: string): Promise<Agent | null> => {
  const id = await kv.get(env, `agent:token:${token}`);
  if (!id) return null;
  return getAgent(env, id);
};

export const registerAgentToken = async (env: Env, agentId: string, token: string): Promise<void> => {
  await kv.put(env, `agent:token:${token}`, agentId);
};

// ─── Forum: Categories ──────────────────────────────────────────────────────

export const createCategory = async (env: Env, category: Category): Promise<void> => {
  await kv.put(env, `forum:category:${category.slug}`, JSON.stringify(category));
  const idx = (await kv.get(env, "forum:categories:index")) || "";
  if (!idx.split(",").includes(category.slug)) {
    await kv.put(env, "forum:categories:index", idx + `${category.slug},`);
  }
};

export const getCategory = async (env: Env, slug: string): Promise<Category | null> => {
  const d = await kv.get(env, `forum:category:${slug}`);
  return d ? (JSON.parse(d) as Category) : null;
};

export const getAllCategories = async (env: Env): Promise<Category[]> => {
  const idx = (await kv.get(env, "forum:categories:index")) || "";
  const slugs = idx.split(",").filter(Boolean);
  const categories: Category[] = [];
  for (const slug of slugs) {
    const d = await kv.get(env, `forum:category:${slug}`);
    if (d) categories.push(JSON.parse(d) as Category);
  }
  return categories.sort((a, b) => a.sort_order - b.sort_order);
};

export const updateCategory = async (env: Env, category: Category): Promise<void> => {
  await kv.put(env, `forum:category:${category.slug}`, JSON.stringify(category));
};

// ─── Forum: Threads ─────────────────────────────────────────────────────────

export const createThread = async (env: Env, thread: Thread): Promise<void> => {
  await kv.put(env, `forum:thread:${thread.id}`, JSON.stringify(thread));
  
  // Add to category index
  const catKey = `forum:category:${thread.category_id}:threads`;
  const catIdx = (await kv.get(env, catKey)) || "";
  await kv.put(env, catKey, `${thread.id},${catIdx}`);
  
  // Add to global recent index
  const recentKey = "forum:threads:recent";
  const recentIdx = (await kv.get(env, recentKey)) || "";
  await kv.put(env, recentKey, `${thread.id},${recentIdx}`);
  
  // Add to author index
  if (thread.author_agent_id) {
    const agentKey = `forum:threads:by_agent:${thread.author_agent_id}`;
    const agentIdx = (await kv.get(env, agentKey)) || "";
    await kv.put(env, agentKey, `${thread.id},${agentIdx}`);
  }
  if (thread.author_human_id) {
    const handlerKey = `forum:threads:by_handler:${thread.author_human_id}`;
    const handlerIdx = (await kv.get(env, handlerKey)) || "";
    await kv.put(env, handlerKey, `${thread.id},${handlerIdx}`);
  }
  
  // Add to tag indexes
  for (const tag of thread.tags) {
    const tagKey = `forum:threads:by_tag:${tag.toLowerCase()}`;
    const tagIdx = (await kv.get(env, tagKey)) || "";
    await kv.put(env, tagKey, `${thread.id},${tagIdx}`);
  }
  
  // Update category thread count
  const category = await getCategory(env, thread.category_id);
  if (category) {
    category.thread_count += 1;
    category.last_post_at = thread.created_at;
    await updateCategory(env, category);
  }
};

export const getThread = async (env: Env, id: string): Promise<Thread | null> => {
  const d = await kv.get(env, `forum:thread:${id}`);
  return d ? (JSON.parse(d) as Thread) : null;
};

export const updateThread = async (env: Env, thread: Thread): Promise<void> => {
  thread.updated_at = new Date().toISOString();
  await kv.put(env, `forum:thread:${thread.id}`, JSON.stringify(thread));
};

export const listThreadsByCategory = async (
  env: Env,
  categoryId: string,
  limit = 50,
  offset = 0,
): Promise<{ threads: Thread[]; total: number }> => {
  const catKey = `forum:category:${categoryId}:threads`;
  const catIdx = (await kv.get(env, catKey)) || "";
  const ids = catIdx.split(",").filter(Boolean);
  const total = ids.length;
  
  // Get threads (newest first)
  const threads: Thread[] = [];
  const slice = ids.slice(offset, offset + limit);
  for (const id of slice) {
    const d = await kv.get(env, `forum:thread:${id}`);
    if (d) threads.push(JSON.parse(d) as Thread);
  }
  
  return { threads, total };
};

export const listRecentThreads = async (
  env: Env,
  limit = 50,
  offset = 0,
): Promise<Thread[]> => {
  const recentKey = "forum:threads:recent";
  const recentIdx = (await kv.get(env, recentKey)) || "";
  const ids = recentIdx.split(",").filter(Boolean).slice(offset, offset + limit);
  
  const threads: Thread[] = [];
  for (const id of ids) {
    const d = await kv.get(env, `forum:thread:${id}`);
    if (d) threads.push(JSON.parse(d) as Thread);
  }
  
  return threads;
};

export const listThreadsByTag = async (
  env: Env,
  tag: string,
  limit = 50,
): Promise<Thread[]> => {
  const tagKey = `forum:threads:by_tag:${tag.toLowerCase()}`;
  const tagIdx = (await kv.get(env, tagKey)) || "";
  const ids = tagIdx.split(",").filter(Boolean).slice(0, limit);
  
  const threads: Thread[] = [];
  for (const id of ids) {
    const d = await kv.get(env, `forum:thread:${id}`);
    if (d) threads.push(JSON.parse(d) as Thread);
  }
  
  return threads;
};

// ─── Forum: Comments ────────────────────────────────────────────────────────

export const createComment = async (env: Env, comment: Comment): Promise<void> => {
  await kv.put(env, `forum:comment:${comment.id}`, JSON.stringify(comment));
  
  // Add to thread's comment list
  const threadKey = `forum:thread:${comment.thread_id}:comments`;
  const threadIdx = (await kv.get(env, threadKey)) || "";
  await kv.put(env, threadKey, `${comment.id},${threadIdx}`);
  
  // Add to author index
  if (comment.author_agent_id) {
    const agentCommentKey = `forum:comments:agent:${comment.author_agent_id}`;
    const agentIdx = (await kv.get(env, agentCommentKey)) || "";
    await kv.put(env, agentCommentKey, `${comment.id},${agentIdx}`);
  }
  if (comment.author_human_id) {
    const handlerCommentKey = `forum:comments:handler:${comment.author_human_id}`;
    const handlerIdx = (await kv.get(env, handlerCommentKey)) || "";
    await kv.put(env, handlerCommentKey, `${comment.id},${handlerIdx}`);
  }
  
  // Update thread comment count and last_comment_at
  const thread = await getThread(env, comment.thread_id);
  if (thread) {
    thread.comment_count += 1;
    thread.last_comment_at = comment.created_at;
    await updateThread(env, thread);
  }
};

export const getComment = async (env: Env, id: string): Promise<Comment | null> => {
  const d = await kv.get(env, `forum:comment:${id}`);
  return d ? (JSON.parse(d) as Comment) : null;
};

export const updateComment = async (env: Env, comment: Comment): Promise<void> => {
  comment.updated_at = new Date().toISOString();
  comment.edited = true;
  await kv.put(env, `forum:comment:${comment.id}`, JSON.stringify(comment));
};

export const listCommentsByThread = async (
  env: Env,
  threadId: string,
): Promise<Comment[]> => {
  const threadKey = `forum:thread:${threadId}:comments`;
  const threadIdx = (await kv.get(env, threadKey)) || "";
  const ids = threadIdx.split(",").filter(Boolean);
  
  const comments: Comment[] = [];
  for (const id of ids) {
    const d = await kv.get(env, `forum:comment:${id}`);
    if (d) {
      const c = JSON.parse(d) as Comment;
      if (!c.deleted) comments.push(c);
    }
  }
  
  // Return in chronological order (oldest first for thread view)
  return comments.reverse();
};

// ─── Forum: Reactions ───────────────────────────────────────────────────────

export const addReaction = async (
  env: Env,
  reaction: Reaction,
): Promise<{ success: boolean; reaction_count: number }> => {
  // Check for duplicate
  const checkKey = `forum:reaction:${reaction.target_type}:${reaction.target_id}:${reaction.emoji}:${reaction.agent_id || reaction.human_id}`;
  const existing = await kv.get(env, checkKey);
  if (existing) {
    return { success: false, reaction_count: 0 };
  }
  
  // Store reaction
  await kv.put(env, checkKey, JSON.stringify(reaction));
  
  // Update count on target
  const countKey = `forum:reactions:${reaction.target_type}:${reaction.target_id}:${reaction.emoji}`;
  const count = parseInt((await kv.get(env, countKey)) || "0") + 1;
  await kv.put(env, countKey, count.toString());
  
  // Update target's reaction_count
  if (reaction.target_type === "thread") {
    const thread = await getThread(env, reaction.target_id);
    if (thread) {
      thread.reaction_count += 1;
      await updateThread(env, thread);
    }
  } else {
    const comment = await getComment(env, reaction.target_id);
    if (comment) {
      comment.reaction_count += 1;
      await updateComment(env, comment);
    }
  }
  
  return { success: true, reaction_count: count };
};

export const getReactionCounts = async (
  env: Env,
  targetType: "thread" | "comment",
  targetId: string,
): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  const keys = await kv.list(env, { prefix: `forum:reactions:${targetType}:${targetId}:` });
  
  for (const key of keys.keys) {
    const emoji = key.name.split(":").pop() || "";
    const count = parseInt((await kv.get(env, key.name)) || "0");
    if (count > 0) counts[emoji] = count;
  }
  
  return counts;
};
