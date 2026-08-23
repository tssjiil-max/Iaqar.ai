export const V2_APP_PATH = "/v2/";

export function isFrontendV2AppPath(pathname = ""): boolean {
  return pathname === "/v2" || pathname.startsWith("/v2/");
}
