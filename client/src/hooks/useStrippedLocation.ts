// useStrippedLocation — location hook that strips trailing slashes from the pathname.
//
// Why this exists: CF Pages auto-trailing-slashes every path it serves. So
// requesting `/privacy-policy` returns 302 → `/privacy-policy/`, and the
// browser ends up at `/privacy-policy/`. Wouter's <Route path="/privacy-policy">
// does exact-match by default, so the route doesn't render and <main> is empty.
//
// This hook returns the location with the trailing slash stripped (when present
// and not the bare `/`). Drop it in as <Router hook={useStrippedLocation as any}>
// to make wouter match clean routes regardless of the URL form the browser ends
// up at.
//
// IMPORTANT: wouter's hook contract is `() => [location, navigate]`. Returning
// only `[location]` breaks the Router — `useLocation()` downstream returns
// `[undefined, undefined]` and `<Switch>` ends up rendering nothing. We must
// pair the stripped location with wouter's `navigate` so callers that destructure
// `const [location, navigate] = useLocation()` still get a working navigate.

import {
  useLocationProperty,
  navigate as wouterNavigate,
} from "wouter/use-browser-location";

const stripTrailingSlash = (path: string): string => {
  if (!path) return path;
  if (path === "/") return path;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
};

const currentStrippedPath = () =>
  stripTrailingSlash(
    typeof window !== "undefined" ? window.location.pathname : "/"
  );

// Server-safe path resolver — returns "/" on SSR because wouter will SSR-render the
// homepage for the matching "/" route.
const currentStrippedPathSSr = () => "/";

export const useStrippedLocation = () => [
  useLocationProperty(currentStrippedPath, currentStrippedPathSSr),
  wouterNavigate,
] as const;

export default useStrippedLocation;