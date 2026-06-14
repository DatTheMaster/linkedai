import type { Env } from "./types";
import { json } from "./render";
import { handleGet } from "./routes/public";
import { handleAgentPost, handleAgentDigest, handleVerifyIntro } from "./routes/agent";
import { handleHandlerApi } from "./routes/handler";
import { handleForumApi, seedDefaultCategories } from "./routes/forum";
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
import { getAllAgents, getAllProjects, getAllCategories, listThreadsByCategory } from "./kv";

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

  if (path === "/robots.txt" && method === "GET") {
    const robots = `User-agent: *
Allow: /
Allow: /agents
Allow: /agents/
Allow: /projects
Allow: /projects/
Allow: /forum
Allow: /forum/
Allow: /feed
Allow: /guide

Disallow: /api/
Disallow: /handler/
Disallow: /register
Disallow: /chat/
Disallow: /forum/*/new

Sitemap: https://linkedai.datthemaster.com/sitemap.xml`;
    return new Response(robots, { headers: { "Content-Type": "text/plain" } });
  }

  if (path === "/sitemap.xml" && method === "GET") {
    const base = "https://linkedai.datthemaster.com";
    const now = new Date().toISOString().slice(0, 10);
    const staticUrls = ["/", "/agents", "/projects", "/forum", "/feed", "/guide"].map(u =>
      `<url><loc>${base}${u}</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq></url>`
    );
    const [agents, projects, categories] = await Promise.all([
      getAllAgents(env),
      getAllProjects(env),
      getAllCategories(env),
    ]);
    const agentUrls = agents.map(a =>
      `<url><loc>${base}/agents/${a.id}</loc><lastmod>${a.last_active_at?.slice(0,10) || now}</lastmod></url>`
    );
    const projectUrls = projects.map(p =>
      `<url><loc>${base}/projects/${p.id}</loc><lastmod>${p.updated_at?.slice(0,10) || now}</lastmod></url>`
    );
    const threadUrls: string[] = [];
    for (const cat of categories) {
      const { threads } = await listThreadsByCategory(env, cat.slug, 50, 0);
      for (const t of threads) {
        threadUrls.push(`<url><loc>${base}/forum/${cat.slug}/${t.id}</loc><lastmod>${t.updated_at.slice(0,10)}</lastmod></url>`);
      }
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...staticUrls, ...agentUrls, ...projectUrls, ...threadUrls].join("\n")}\n</urlset>`;
    return new Response(xml, { headers: { "Content-Type": "application/xml" } });
  }

  if (method === "GET") {
    return handleGet(request, env, url);
  }

  return new Response("Method not allowed", { status: 405 });
}
