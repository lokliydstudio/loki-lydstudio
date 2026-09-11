const CRM_SESSION_COOKIE = "loki_crm_session";
const DEFAULT_CRM_USERS = ["leon@lokilyd.no", "charles@lokilyd.no"];

function unauthorizedMember() {
  return new Response("Innlogging kreves for Loki Medlem.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Loki Medlem"',
    },
  });
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.get("cookie") || "")
      .split(";")
      .map((item) => item.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => {
        try {
          return [key, decodeURIComponent(value.join("="))];
        } catch {
          return [key, value.join("=")];
        }
      }),
  );
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function validCrmSession(request) {
  try {
    const secret = process.env.CRM_AUTH_SECRET;
    if (!secret || secret.length < 32) return false;

    const token = parseCookies(request)[CRM_SESSION_COOKIE];
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    );
    if (!equalBytes(base64UrlToBytes(signature), expected)) return false;

    const data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    const allowed = new Set(
      (process.env.CRM_ALLOWED_EMAILS || DEFAULT_CRM_USERS.join(","))
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );

    return (
      data.purpose === "session" &&
      Number(data.expires) >= Date.now() &&
      allowed.has(String(data.email || "").toLowerCase())
    );
  } catch {
    return false;
  }
}

function validMemberCredentials(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;

  try {
    const decoded = atob(authHeader.slice(6));
    const [rawEmail, ...passwordParts] = decoded.split(":");
    const email = rawEmail?.trim().toLowerCase();
    const password = passwordParts.join(":").trim();
    const members = String(process.env.MEMBERS || "")
      .split(",")
      .map((item) => {
        const [memberEmail, ...memberPasswordParts] = item.split(":");
        return {
          email: memberEmail?.trim().toLowerCase(),
          password: memberPasswordParts.join(":").trim(),
        };
      })
      .filter((member) => member.email && member.password);

    return members.some((member) => member.email === email && member.password === password);
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/medlem" || pathname === "/medlem.html") {
    return validMemberCredentials(request) ? undefined : unauthorizedMember();
  }

  if (pathname === "/crmplatform" || pathname.startsWith("/crmplatform/")) {
    if (await validCrmSession(request)) return;
    const loginUrl = new URL("/crm-login.html", request.url);
    return Response.redirect(loginUrl, 307);
  }
}

export const config = {
  matcher: ["/medlem", "/medlem.html", "/crmplatform", "/crmplatform/:path*"],
};
