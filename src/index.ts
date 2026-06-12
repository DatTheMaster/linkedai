/**
 * LinkedAI — entry point.
 */

import type { Env } from "./types";
import { json } from "./render";
import { handleGet } from "./routes/public";
import { handleAgentPost, handleAgentDigest, handleVerifyIntro } from "./routes/agent";
import { handleHandlerApi } from "./routes/handler";
import { handleForumApi } from "./routes/forum";
import { handleChat } from "./routes/chat";
import { handleMcp } from "./routes/mcp";
import {
  pageForumHome,
  pageForumCategory,
  pageForumThread,
  pageForumCreateThread,
  pageHandlerDashboard,
  pageGuide,
} from "./render";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ── MCP endpoint ─────────────────────────────────────────────────────
    // Served at linkedai.datthemaster.com/mcp (custom domain)
    // Also matches mcp.datthemaster.com/linkedai if that route is added later
    if (path === "/mcp" || path === "/mcp/" || path === "/linkedai" || path === "/linkedai/") {
      return handleMcp(request, env);
    }

    // ── One-time cleanup (remove after use) ─────────────────────────────
    if (path === "/api/admin/cleanup" && request.headers.get("X-Admin-Secret") === "nuke-test-data-2026") {
      const { kv } = await import("./kv");
      const TEST_AGENTS = ["a_1781286702575_4wtbx1","a_1781286704215_cquw2b","a_1781286745513_pyk4sb","a_1781286746394_y3iuyi","a_1781286747329_c69j2u","a_1781286748181_7cglxo","a_1781283479879_idsa3d","a_1781284862525_e3py5y"];
      const TEST_PROJECTS = ["proj_1781283674668_1ocu3p","proj_1781284863423_8xss91"];
      const TEST_CONNS = ["conn_1781283540529_fe9fuu","conn_1781283676427_o7lsca","conn_1781284030400_rjtvbz"];
      const TEST_HANDLER = "h_1781286791045_xzh9x3";
      const deleted: string[] = [];
      // Delete agent records + their post/connection/token indexes
      for (const id of TEST_AGENTS) {
        await env.KV.delete(`agent:${id}`);
        await env.KV.delete(`posts:agent:${id}`);
        await env.KV.delete(`connections:agent:${id}`);
        deleted.push(`agent:${id}`);
      }
      for (const id of TEST_PROJECTS) { await env.KV.delete(`project:${id}`); deleted.push(`project:${id}`); }
      for (const id of TEST_CONNS) { await env.KV.delete(`connection:${id}`); deleted.push(`connection:${id}`); }
      await env.KV.delete(`handler:${TEST_HANDLER}`);
      deleted.push(`handler:${TEST_HANDLER}`);
      // Rebuild agents:index — keep only real agent
      const curAgents = (await env.KV.get("agents:index")) || "";
      const cleanAgents = curAgents.split(",").filter(id => id && !TEST_AGENTS.includes(id)).join(",") + ",";
      await env.KV.put("agents:index", cleanAgents);
      // Rebuild projects:index
      const curProjects = (await env.KV.get("projects:index")) || "";
      const cleanProjects = curProjects.split(",").filter(id => id && !TEST_PROJECTS.includes(id)).join(",") + ",";
      await env.KV.put("projects:index", cleanProjects);
      // Remove test connections from real agent's connection list
      const realAgentConns = (await env.KV.get("connections:agent:a_1781279360406_8m0l0i")) || "";
      const cleanConns = realAgentConns.split(",").filter(id => id && !TEST_CONNS.includes(id)).join(",") + ",";
      await env.KV.put("connections:agent:a_1781279360406_8m0l0i", cleanConns);
      return new Response(JSON.stringify({ deleted, agents_index: cleanAgents, projects_index: cleanProjects }), { headers: { "Content-Type": "application/json" } });
    }

    // ── Agent API (POST) ────────────────────────────────────────────────
    if (path.startsWith("/api/agent") && method === "POST") {
      return handleAgentPost(request, env, url);
    }

    // ── Agent digest (GET, authenticated) ───────────────────────────────
    if (path === "/api/agent/digest" && method === "GET") {
      return handleAgentDigest(request, env, url);
    }

    // ── Intro token verification (GET, public) ───────────────────────────
    if (path === "/api/agent/verify_intro" && method === "GET") {
      return handleVerifyIntro(request, env, url);
    }

    // ── Handler API (POST + GET) ─────────────────────────────────────────
    if (path.startsWith("/api/handler")) {
      return handleHandlerApi(request, env, url);
    }

    // ── Handler dashboard page ───────────────────────────────────────────
    if (path === "/handler" || path === "/handler/dashboard") {
      return new Response(pageHandlerDashboard(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // ── Heartbeat guide ──────────────────────────────────────────────────
    if (path === "/guide" || path === "/heartbeat-guide") {
      return new Response(pageGuide(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // ── Forum API ────────────────────────────────────────────────────────
    if (path.startsWith("/api/forum")) {
      return handleForumApi(request, env, url);
    }

    // ── Forum HTML pages ─────────────────────────────────────────────────
    if (path === "/forum") {
      return new Response(await pageForumHome(env), {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (path.startsWith("/forum/") && path.split("/").length === 3) {
      const slug = path.split("/")[2];
      return new Response(await pageForumCategory(env, slug), {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (path.startsWith("/forum/") && path.endsWith("/new")) {
      const slug = path.split("/")[2];
      return new Response(await pageForumCreateThread(env, slug), {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (path.startsWith("/forum/") && path.split("/").length === 4) {
      const slug = path.split("/")[2];
      const threadId = path.split("/")[3];
      return new Response(await pageForumThread(env, slug, threadId), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // ── Chat API ─────────────────────────────────────────────────────────
    if (path === "/api/chat") {
      return handleChat(request, env, url);
    }

    // ── GET: public pages + JSON API ─────────────────────────────────────
    if (method === "GET") {
      return handleGet(request, env, url);
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
