import { NextResponse, type NextRequest } from "next/server";

type MailpitRecipient = { Address?: string };
type MailpitListMessage = {
  ID: string;
  Subject?: string;
  Created?: string;
  To?: MailpitRecipient[];
};

function extractRecoveryUrl(html: string): string | null {
  const normalized = html.replace(/&amp;/g, "&");

  const interstitial = normalized.match(
    /https?:\/\/[^"\s<>]+\/auth\/recovery\?[^"\s<>]*type=recovery[^"\s<>]*/i,
  );
  if (interstitial?.[0]) {
    return interstitial[0];
  }

  const verify = normalized.match(
    /https?:\/\/[^"\s<>]+\/auth\/v1\/verify\?[^"\s<>]*type=recovery[^"\s<>]*/i,
  );
  return verify?.[0] ?? null;
}

/**
 * Dev-only helper: read the latest password-reset email from local Mailpit.
 * Avoids CORS blocks when the browser polls Mailpit directly.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  const since = request.nextUrl.searchParams.get("since");

  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const sinceMs = since ? Date.parse(since) : 0;

  try {
    const listRes = await fetch("http://127.0.0.1:54324/api/v1/messages", {
      cache: "no-store",
    });

    if (!listRes.ok) {
      return NextResponse.json({
        found: false,
        reason: "mailpit_unavailable",
      });
    }

    const list = (await listRes.json()) as { messages?: MailpitListMessage[] };

    for (const message of list.messages ?? []) {
      if (!message.Subject?.toLowerCase().includes("reset")) {
        continue;
      }

      const createdMs = message.Created ? Date.parse(message.Created) : 0;
      if (sinceMs && createdMs + 2000 < sinceMs) {
        continue;
      }

      const recipients = message.To ?? [];
      const matchesRecipient = recipients.some(
        (recipient) => recipient.Address?.toLowerCase() === email,
      );
      if (!matchesRecipient) {
        continue;
      }

      const detailRes = await fetch(
        `http://127.0.0.1:54324/api/v1/message/${message.ID}`,
        { cache: "no-store" },
      );
      if (!detailRes.ok) {
        continue;
      }

      const detail = (await detailRes.json()) as {
        HTML?: string;
        Text?: string;
      };
      const body = detail.HTML ?? detail.Text ?? "";
      const resetUrl = extractRecoveryUrl(body);

      return NextResponse.json({
        found: true,
        resetUrl,
        subject: message.Subject,
        createdAt: message.Created,
      });
    }

    return NextResponse.json({ found: false });
  } catch {
    return NextResponse.json({ found: false, reason: "mailpit_unavailable" });
  }
}
