import { createFileRoute } from "@tanstack/react-router";
import { getAppPassword, isAuthenticated } from "@/lib/auth-server";

export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const configured = Boolean(getAppPassword());
        const authenticated = configured
          ? await isAuthenticated(request)
          : false;
        return new Response(
          JSON.stringify({ authenticated, configured }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
