import { NextResponse, type NextRequest } from "next/server";

/**
 * Dev-only: check whether an email is registered in local Supabase Auth.
 * Helps explain why Mailpit stays empty (GoTrue never sends reset mail for
 * unknown addresses, but still returns success to prevent enumeration).
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json({
      checked: false,
      reason: "missing_service_role",
    });
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      return NextResponse.json({ checked: false, reason: "admin_api_error" });
    }

    const data = (await res.json()) as {
      users?: { email?: string }[];
    };

    const registered = (data.users ?? []).some(
      (user) => user.email?.toLowerCase() === email,
    );

    return NextResponse.json({ checked: true, registered });
  } catch {
    return NextResponse.json({ checked: false, reason: "admin_api_error" });
  }
}
