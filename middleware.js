function unauthorized() {
  return new Response("Innlogging kreves for Loki Medlem.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Loki Medlem"',
    },
  });
}

export default function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Beskytt kun medlemssiden
  if (pathname !== "/medlem.html" && pathname !== "/medlem") {
    return;
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

  // Gi tilgang
  return;
}

export const config = {
  matcher: ["/medlem", "/medlem.html"],
};
