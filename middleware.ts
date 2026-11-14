import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type UserRole = "admin" | "manager" | "supervisor" | "worker";

const requiredRoles: Record<string, UserRole[]> = {
  "/helmet": ["worker"],
  "/dashboard": ["admin", "manager", "supervisor"],
  "/setup": ["admin"],
  "/demo": ["admin"],
};

function destinationForRole(role: UserRole): string {
  if (role === "worker") return "/helmet";
  if (role === "admin") return "/setup";
  return "/dashboard";
}

function redirectWithCookies(request: NextRequest, response: NextResponse, path: string): NextResponse {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const protectedPath = Object.keys(requiredRoles).find((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!user) {
    return protectedPath ? redirectWithCookies(request, response, "/login") : response;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.active) {
    await supabase.auth.signOut();
    return redirectWithCookies(request, response, "/login");
  }

  const role = profile.role as UserRole;
  if (pathname === "/login" || pathname === "/") {
    return redirectWithCookies(request, response, destinationForRole(role));
  }

  if (protectedPath && !requiredRoles[protectedPath].includes(role)) {
    return redirectWithCookies(request, response, destinationForRole(role));
  }

  return response;
}

export const config = {
  matcher: ["/", "/login", "/helmet/:path*", "/dashboard/:path*", "/setup/:path*", "/demo/:path*"],
};
