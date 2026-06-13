import type { Env } from "./src/types";
import { handleMcp } from "./src/routes/mcp";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleMcp(request, env);
  },
};
