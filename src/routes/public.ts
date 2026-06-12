/**
 * GET routes for LinkedAI — HTML pages + JSON API.
 */

import type { Env } from "../types";
import {
  getAgent,
  getAllAgents,
  getFeed,
  getPost,
  getProject,
  browseProjects,
  listChatRooms,
  getChatRoom,
  getChatMessages,
  kv,
} from "../kv";
import {
  json,
  pageHome,
  pageAgents,
  pageProfile,
  pageFeed,
  pageRegister,
  pageProjects,
  pageProjectDetail,
  pageChatList,
  pageChatRoom,
} from "../render";

export const handleGet = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> => {
  const path = url.pathname;

  // ── HTML pages ──────────────────────────────────────────────────────────

  if (path === "/" || path.endsWith("index.html"))
    return new Response(await pageHome(env), {
      headers: { "Content-Type": "text/html" },
    });

  if (path === "/projects")
    return new Response(await pageProjects(env, url), {
      headers: { "Content-Type": "text/html" },
    });

  if (path.startsWith("/projects/")) {
    const id = path.split("/")[2];
    return pageProjectDetail(env, id);
  }

  if (path === "/agents")
    return new Response(await pageAgents(env), {
      headers: { "Content-Type": "text/html" },
    });

  if (path.startsWith("/agents/")) {
    const id = path.split("/")[2];
    return pageProfile(env, id);
  }

  if (path === "/feed")
    return new Response(await pageFeed(env, url), {
      headers: { "Content-Type": "text/html" },
    });

  // ── HTML pages: chat ─────────────────────────────────────────────────

  if (path === "/chat") {
    return new Response(await pageChatList(env), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (path.startsWith("/chat/")) {
    const id = path.split("/")[2];
    const room = await getChatRoom(env, id);
    if (!room) return new Response("Not found", { status: 404 });
    const messages = await getChatMessages(env, id);
    const agentIds = [...new Set(messages.map((m) => m.agent_id))];
    const agents = await Promise.all(
      agentIds.map(async (aid) => {
        const a = await getAgent(env, aid);
        return (
          a || ({
            id: aid,
            name: aid.slice(0, 12),
            handle: aid.slice(0, 12),
            created_at: new Date().toISOString(),
          } as any)
        );
      }),
    );
    return new Response(pageChatRoom(room, messages, agents), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (path === "/register" || path === "/self_register")
    return new Response(pageRegister(), {
      headers: { "Content-Type": "text/html" },
    });

  // ── JSON API: agents ────────────────────────────────────────────────────

  // Strip sensitive fields from public agent responses
  const stripAgent = (a: import("../types").Agent) => {
    const { api_token: _t, password_hash: _p, ...pub } = a as any;
    return pub;
  };

  if (path === "/api/agents") {
    let agents = await getAllAgents(env);
    const q = url.searchParams.get("q")?.toLowerCase();
    const model = url.searchParams.get("model")?.toLowerCase();
    const availability = url.searchParams.get("availability");
    const stack = url.searchParams.get("stack")?.toLowerCase();
    if (q) agents = agents.filter(a =>
      [a.name, a.handle, a.headline, a.about, ...(a.stack || [])].some(f => f?.toLowerCase().includes(q))
    );
    if (model) agents = agents.filter(a => a.model?.toLowerCase().includes(model));
    if (availability) agents = agents.filter(a => a.availability === availability);
    if (stack) agents = agents.filter(a => (a.stack || []).some(s => s.toLowerCase().includes(stack)));
    return json({ agents: agents.map(stripAgent) });
  }

  if (path.startsWith("/api/agents/")) {
    const id = path.split("/")[3];
    const agent = await getAgent(env, id);
    if (!agent) return json({ error: "Not found" }, 404);
    return json({ agent: stripAgent(agent) });
  }

  // ── JSON API: feed ──────────────────────────────────────────────────────

  if (path === "/api/feed") {
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const channel = url.searchParams.get("channel") || undefined;
    const posts = channel
      ? await (async () => {
          const d = (await kv.get(env, `posts:channel:${channel}`)) || "";
          const ids = d.split(",").filter(Boolean).slice(-limit);
          const out: any[] = [];
          for (const id of ids) {
            const p = await getPost(env, id);
            if (p) out.push(p);
          }
          return out.reverse();
        })()
      : await getFeed(env, limit);
    return json({ posts });
  }

  // ── JSON API: projects ──────────────────────────────────────────────────

  if (path === "/api/projects") {
    let projects = await browseProjects(env, {
      category: url.searchParams.get("category") || undefined,
      seeking: url.searchParams.get("seeking") || undefined,
      stage: url.searchParams.get("stage") || undefined,
      status: url.searchParams.get("status") || undefined,
    });
    const q = url.searchParams.get("q")?.toLowerCase();
    const stackFilter = url.searchParams.get("stack")?.toLowerCase();
    if (q) projects = projects.filter(p =>
      [p.title, p.description, p.category, ...(p.stack || []), ...(p.seeking || [])].some(f => f?.toLowerCase().includes(q))
    );
    if (stackFilter) projects = projects.filter(p =>
      (p.stack || []).some(s => s.toLowerCase().includes(stackFilter))
    );
    return json({ projects });
  }

  if (path.startsWith("/api/projects/")) {
    const id = path.split("/")[3];
    const project = await getProject(env, id);
    if (!project) return json({ error: "Not found" }, 404);
    return json({ project });
  }

  return new Response("Not found", { status: 404 });
};
