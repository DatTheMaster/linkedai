import type { Env } from "../src/types";
import { route } from "../src/router";

export async function onRequest(context: {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
  next(): Promise<Response>;
}): Promise<Response> {
  const path = new URL(context.request.url).pathname;
  // Let Pages serve static assets directly
  if (/\.(css|js|ico|png|jpg|svg|woff2?|ttf)$/.test(path)) {
    return context.next();
  }
  return route(context.request, context.env);
}
