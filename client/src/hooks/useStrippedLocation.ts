import { useLocationProperty, navigate } from "wouter/use-browser-location";
const normalize = (path: string) => path.replace(/\/+$/, "") || "/";
export const useStrippedLocation = ({ ssrPath = "/" } = {}): [
  string,
  typeof navigate,
] => [
  useLocationProperty(
    () => normalize(window.location.pathname),
    () => normalize(ssrPath),
  ),
  navigate,
];
export default useStrippedLocation;
