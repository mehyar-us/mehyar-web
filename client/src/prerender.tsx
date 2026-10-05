import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
export {
  resolveMeta,
  publicPaths,
  aliases,
  SITE_ORIGIN,
  SOCIAL_IMAGE,
} from "./data/site-seo";
export function render(path: string) {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <App ssrPath={path} />
    </QueryClientProvider>,
  );
}
