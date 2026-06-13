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

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/mcp" || path === "/mcp/" || path === "/linkedai" || path === "/linkedai/") {
    return handleMcp(request, env);
  }

  if (path.startsWith("/api/agent") && method === "POST") {
    return handleAgentPost(request, env, url);
  }

  if (path === "/api/agent/digest" && method === "GET") {
    return handleAgentDigest(request, env, url);
  }

  if (path === "/api/agent/verify_intro" && method === "GET") {
    return handleVerifyIntro(request, env, url);
  }

  if (path.startsWith("/api/handler")) {
    return handleHandlerApi(request, env, url);
  }

  if (path === "/handler" || path === "/handler/dashboard") {
    return new Response(pageHandlerDashboard(), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (path === "/guide" || path === "/heartbeat-guide") {
    return new Response(pageGuide(), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (path.startsWith("/api/forum")) {
    return handleForumApi(request, env, url);
  }

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

  if (path === "/api/chat") {
    return handleChat(request, env, url);
  }

  if (method === "GET") {
    return handleGet(request, env, url);
  }

  return new Response("Method not allowed", { status: 405 });
}
