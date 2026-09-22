import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge of every request: attaches a correlation ID (propagated to audit logs),
 * sets security headers and performs an optimistic session-cookie check.
 * Authorisation itself is enforced server-side in every page and action.
 */

const PUBLIC = ["/login", "/api/health", "/api/agents/run"];

export function proxy(request: NextRequest) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isPublic && !request.cookies.has("atgl_session")) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: { "x-correlation-id": correlationId } });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return withSecurityHeaders(NextResponse.redirect(url), correlationId);
  }

  const headers = new Headers(request.headers);
  headers.set("x-correlation-id", correlationId);
  return withSecurityHeaders(NextResponse.next({ request: { headers } }), correlationId);
}

function withSecurityHeaders(res: NextResponse, correlationId: string): NextResponse {
  res.headers.set("x-correlation-id", correlationId);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
