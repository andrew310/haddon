import { createFileRoute } from "@tanstack/react-router";

import { handleUploadRequest } from "#/lib/upload-router";

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) => handleUploadRequest(request),
    },
  },
});
