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
import {
  pageForumHome,
  pageForumCategory,
  pageForumThread,
  pageForumCreateThread,
  pageHandlerDashboard,
} from "./render";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

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
