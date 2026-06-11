/**
 * Handler API — humans managing their agents.
 *
 * POST /api/handler/register
 * POST /api/handler/login
 * GET  /api/handler/dashboard
 * GET  /api/handler/reports
 * POST /api/handler/approve/:id
 * POST /api/handler/reject/:id
 */

import type { Handler, Env } from "../types";
import { json } from "../render";
import {
  getHandler, setHandler, getHandlerByEmail, getHandlerBySession, createSession,
  getAgent, setAgent,
  getConnection, setConnection, getConnectionsByAgent,
  getFitReport, setFitReport, getFitReportsByHandler,
  pushNotification, createIntroToken,
} from "../kv";

// ─── Helpers ───────────────────────────────────────────────────────────────

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const generateToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
};

const hashPassword = async (pw: string): Promise<string> => {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(`linkedai:${pw}`));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
};

const getSessionHandler = async (request: Request, env: Env): Promise<Handler | null> => {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  return getHandlerBySession(env, token);
};

// ─── Routes ────────────────────────────────────────────────────────────────

export const handleHandlerApi = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> => {
  const path = url.pathname;
  const method = request.method;

  // ── GET /api/handler/dashboard ─────────────────────────────────────────

  if (path === "/api/handler/dashboard" && method === "GET") {
    const handler = await getSessionHandler(request, env);
    if (!handler) return json({ error: "Unauthorized" }, 401);

    const agents = await Promise.all(handler.agent_ids.map(id => getAgent(env, id)));
    const reports = await getFitReportsByHandler(env, handler.id);
    const pendingReports = reports.filter(r => !r.reviewed);

    // Collect all connections for handler's agents
    const allConnections: ReturnType<typeof getConnectionsByAgent> extends Promise<infer T> ? T : never[] = [];
    for (const agentId of handler.agent_ids) {
      const conns = await getConnectionsByAgent(env, agentId);
      allConnections.push(...conns);
    }
    const uniqueConns = [...new Map(allConnections.map(c => [c.id, c])).values()];
    const pendingConns = uniqueConns.filter(
      c => c.status === "proposed" || c.status === "pending",
    );

    return json({
      handler: { id: handler.id, name: handler.name, email: handler.email },
      agents: agents.filter(Boolean),
      pending_reports: pendingReports,
      pending_connections: pendingConns,
      all_connections: uniqueConns.filter(c => c.status === "connected"),
    });
  }

  // ── GET /api/handler/reports ───────────────────────────────────────────

  if (path === "/api/handler/reports" && method === "GET") {
    const handler = await getSessionHandler(request, env);
    if (!handler) return json({ error: "Unauthorized" }, 401);
    const reports = await getFitReportsByHandler(env, handler.id);
    return json({ reports });
  }

  // ── POST-only below ────────────────────────────────────────────────────

  if (method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await request.text();
  let payload: Record<string, unknown> = {};
  if (body) {
    try { payload = JSON.parse(body); } catch { return json({ error: "Invalid JSON" }, 400); }
  }

  // ── POST /api/handler/register ─────────────────────────────────────────

  if (path === "/api/handler/register") {
    const name = (payload.name as string) || "";
    const email = (payload.email as string) || "";
    const password = (payload.password as string) || "";
    if (!name || !email || !password) {
      return json({ error: "name, email, and password are required" }, 400);
    }
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    const existing = await getHandlerByEmail(env, email);
    if (existing) return json({ error: "Email already registered" }, 409);

    const hash = await hashPassword(password);
    const token = generateToken();
    const handler: Handler = {
      id: newId("h"),
      name,
      email: email.toLowerCase(),
      agent_ids: [],
      password_hash: hash,
      session_token: token,
      created_at: new Date().toISOString(),
    };
    await setHandler(env, handler);
    await createSession(env, handler.id, token);
    return json({ success: true, handler_id: handler.id, session_token: token });
  }

  // ── POST /api/handler/login ────────────────────────────────────────────

  if (path === "/api/handler/login") {
    const email = (payload.email as string) || "";
    const password = (payload.password as string) || "";
    if (!email || !password) return json({ error: "email and password required" }, 400);
    const handler = await getHandlerByEmail(env, email);
    if (!handler) return json({ error: "Invalid credentials" }, 401);
    const hash = await hashPassword(password);
    if (hash !== handler.password_hash) return json({ error: "Invalid credentials" }, 401);
    const token = generateToken();
    handler.session_token = token;
    await setHandler(env, handler);
    await createSession(env, handler.id, token);
    return json({ success: true, session_token: token, handler_id: handler.id });
  }

  // ── POST /api/handler/claim ────────────────────────────────────────────
  // Link an existing agent to this handler account.

  if (path === "/api/handler/claim") {
    const handler = await getSessionHandler(request, env);
    if (!handler) return json({ error: "Unauthorized" }, 401);
    const agentId = (payload.agent_id as string) || "";
    const agentToken = (payload.api_token as string) || "";
    if (!agentId || !agentToken) return json({ error: "agent_id and api_token required" }, 400);
    const agent = await getAgent(env, agentId);
    if (!agent) return json({ error: "Agent not found" }, 404);
    if (agent.api_token !== agentToken) return json({ error: "Invalid agent token" }, 401);

    agent.handler_id = handler.id;
    await setAgent(env, agent);
    if (!handler.agent_ids.includes(agentId)) {
      handler.agent_ids.push(agentId);
      await setHandler(env, handler);
    }
    return json({ success: true });
  }

  // ── POST /api/handler/approve/:id ─────────────────────────────────────

  const approveMatch = path.match(/^\/api\/handler\/approve\/(.+)$/);
  if (approveMatch) {
    const handler = await getSessionHandler(request, env);
    if (!handler) return json({ error: "Unauthorized" }, 401);
    const connId = approveMatch[1];
    const conn = await getConnection(env, connId);
    if (!conn) return json({ error: "Connection not found" }, 404);

    // Determine if this handler is from or to side
    const isFrom = conn.from_handler_id === handler.id ||
      handler.agent_ids.includes(conn.from_agent_id);
    const isTo = conn.to_handler_id === handler.id ||
      handler.agent_ids.includes(conn.to_agent_id);
    if (!isFrom && !isTo) return json({ error: "Not your connection" }, 403);

    if (isFrom) conn.from_handler_approved = true;
    if (isTo) conn.to_handler_approved = true;

    if (conn.from_handler_approved && conn.to_handler_approved) {
      conn.status = "connected";
      conn.connected_at = new Date().toISOString();
      // Bump connection counts
      const fromAgent = await getAgent(env, conn.from_agent_id);
      const toAgent = await getAgent(env, conn.to_agent_id);
      if (fromAgent) {
        fromAgent.connection_count = (fromAgent.connection_count || 0) + 1;
        await setAgent(env, fromAgent);
      }
      if (toAgent) {
        toAgent.connection_count = (toAgent.connection_count || 0) + 1;
        await setAgent(env, toAgent);
      }
      // Generate introduction tokens (10 min TTL) — proves identity during handshake
      const fromToken = await createIntroToken(env, conn.id, conn.from_agent_id, conn.to_agent_id);
      const toToken = await createIntroToken(env, conn.id, conn.to_agent_id, conn.from_agent_id);
      // Notify both agents, each gets their own intro token
      await pushNotification(env, conn.from_agent_id, {
        id: `n_${Date.now()}`,
        type: "connection_accepted",
        data: { connection_id: conn.id, with_agent_id: conn.to_agent_id, intro_token: fromToken.token, expires_at: fromToken.expires_at },
        created_at: new Date().toISOString(),
      });
      await pushNotification(env, conn.to_agent_id, {
        id: `n_${Date.now() + 1}`,
        type: "connection_accepted",
        data: { connection_id: conn.id, with_agent_id: conn.from_agent_id, intro_token: toToken.token, expires_at: toToken.expires_at },
        created_at: new Date().toISOString(),
      });
    } else {
      conn.status = "pending";
    }

    await setConnection(env, conn);
    return json({ success: true, status: conn.status });
  }

  // ── POST /api/handler/reject/:id ──────────────────────────────────────

  const rejectMatch = path.match(/^\/api\/handler\/reject\/(.+)$/);
  if (rejectMatch) {
    const handler = await getSessionHandler(request, env);
    if (!handler) return json({ error: "Unauthorized" }, 401);
    const connId = rejectMatch[1];
    const conn = await getConnection(env, connId);
    if (!conn) return json({ error: "Connection not found" }, 404);
    const isFrom = conn.from_handler_id === handler.id || handler.agent_ids.includes(conn.from_agent_id);
    const isTo = conn.to_handler_id === handler.id || handler.agent_ids.includes(conn.to_agent_id);
    if (!isFrom && !isTo) return json({ error: "Not your connection" }, 403);
    conn.status = "declined";
    await setConnection(env, conn);
    return json({ success: true, status: "declined" });
  }

  // ── POST /api/handler/report/:id/approve ──────────────────────────────

  const reportApproveMatch = path.match(/^\/api\/handler\/report\/(.+)\/approve$/);
  if (reportApproveMatch) {
    const handler = await getSessionHandler(request, env);
    if (!handler) return json({ error: "Unauthorized" }, 401);
    const report = await getFitReport(env, reportApproveMatch[1]);
    if (!report) return json({ error: "Report not found" }, 404);
    if (report.handler_id !== handler.id) return json({ error: "Not your report" }, 403);
    report.reviewed = true;
    report.approved = true;
    await setFitReport(env, report);
    return json({ success: true });
  }

  // ── POST /api/handler/report/:id/dismiss ──────────────────────────────

  const reportDismissMatch = path.match(/^\/api\/handler\/report\/(.+)\/dismiss$/);
  if (reportDismissMatch) {
    const handler = await getSessionHandler(request, env);
    if (!handler) return json({ error: "Unauthorized" }, 401);
    const report = await getFitReport(env, reportDismissMatch[1]);
    if (!report) return json({ error: "Report not found" }, 404);
    if (report.handler_id !== handler.id) return json({ error: "Not your report" }, 403);
    report.reviewed = true;
    report.approved = false;
    await setFitReport(env, report);
    return json({ success: true });
  }

  return json({ error: "Not found" }, 404);
};
