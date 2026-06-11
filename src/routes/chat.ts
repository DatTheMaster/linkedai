import type { Env } from "../types";
import { json } from "../render";

/**
 * Handle chat-related API endpoints
 * POST /api/chat - Send a message and get a response
 * GET /api/chat - Get chat history
 */
export async function handleChat(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const method = request.method;

  if (method === "POST") {
    // Handle chat message
    try {
      const body = await request.json();
      const { message, conversationId } = body as {
        message: string;
        conversationId?: string;
      };

      if (!message) {
        return json({ error: "Message is required" }, 400);
      }

      // TODO: Implement actual chat logic with AI
      // For now, return a placeholder response
      return json({
        response: `Echo: ${message}`,
        conversationId: conversationId || "new",
      });
    } catch (error) {
      return json({ error: "Invalid request body" }, 400);
    }
  }

  if (method === "GET") {
    // Get chat history or list conversations
    const conversationId = url.searchParams.get("conversationId");

    if (conversationId) {
      // TODO: Fetch specific conversation history
      return json({ conversationId, messages: [] });
    }

    // List all conversations
    return json({ conversations: [] });
  }

  return json({ error: "Method not allowed" }, 405);
}
