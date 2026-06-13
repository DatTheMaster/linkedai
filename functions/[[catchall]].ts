import type { Env } from "../src/types";
import { route } from "../src/router";

export async function onRequest(context: {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}): Promise<Response> {
  return route(context.request, context.env);
}
