import { NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Innlogging kreves for Loki Medlem.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Loki Medlem"',
    },
  });
}

export function middleware(request) {
  const pathname = request.nextUrl.pathname;

  // Beskytt kun medlemssiden
  if (pathname !== "/medlem.html" && pathname !== "/medlem") {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return unauthorized();
  }

  const encoded = authHeader.split(" ")[1];

  let email = "";
  let password = "";

  try {
    const decoded = atob(encoded);
    const parts = decoded.split(":");
    email = parts[0]?.trim().toLowerCase();
    password = parts.slice(1).join(":").trim();
  } catch {
    return unauthorized();
  }

  const membersRaw = process.env.MEMBERS || "";

  const members = membersRaw
    .split(",")
    .map((item) => {
      const [memberEmail, ...passwordParts] = item.split(":");

      return {
        email: memberEmail?.trim().toLowerCase(),
        password: passwordParts.join(":").trim(),
      };
    })
    .filter((member) => member.email && member.password);

  const isValidMember = members.some((member) => {
    return member.email === email && member.password === password;
  });

  if (!isValidMember) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/medlem", "/medlem.html"],
};
