export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "SocialAI Backend API",
    version: "1.0.0",
    description: "Secure backend API for brand profiles, trend briefs, generation, drafts, and usage metrics.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string" },
          details: { type: "object", additionalProperties: true },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Service health check",
        responses: {
          "200": {
            description: "Healthy",
          },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Current authenticated user",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "User info" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/brand-profiles/me": {
      get: {
        tags: ["BrandProfiles"],
        summary: "Get latest brand profile for current user",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Brand profile" },
        },
      },
      put: {
        tags: ["BrandProfiles"],
        summary: "Create or update latest brand profile",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
        },
        responses: {
          "200": { description: "Saved" },
        },
      },
    },
    "/trends/brief": {
      post: {
        tags: ["Trends"],
        summary: "Generate trend adaptation brief",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
        },
        responses: {
          "201": { description: "Brief created" },
        },
      },
    },
    "/trends/signals/ingest": {
      post: {
        tags: ["Trends"],
        summary: "Ingest manual or external trend signals",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true },
        responses: {
          "201": { description: "Signals ingested" },
        },
      },
    },
    "/trends/signals": {
      get: {
        tags: ["Trends"],
        summary: "List ingested trend signals",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Trend signals" },
        },
      },
    },
    "/trends/worker/status": {
      get: {
        tags: ["Trends"],
        summary: "Get trend ingestion worker status and recent runs",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Worker status" },
        },
      },
    },
    "/trends/worker/run-now": {
      post: {
        tags: ["Trends"],
        summary: "Trigger trend ingestion worker immediately",
        security: [{ bearerAuth: [] }],
        responses: {
          "202": { description: "Worker run accepted" },
        },
      },
    },
    "/autopilot/settings": {
      put: {
        tags: ["Autopilot"],
        summary: "Create or update autopilot settings",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true },
        responses: {
          "200": { description: "Settings saved" },
        },
      },
    },
    "/autopilot/matches/recompute": {
      post: {
        tags: ["Autopilot"],
        summary: "Recompute trend relevance matches for brand/platform",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true },
        responses: {
          "200": { description: "Matches recomputed" },
        },
      },
    },
    "/autopilot/matches": {
      get: {
        tags: ["Autopilot"],
        summary: "List trend relevance matches",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Matches list" },
        },
      },
    },
    "/autopilot/run": {
      post: {
        tags: ["Autopilot"],
        summary: "Run autopilot generation cycle",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true },
        responses: {
          "201": { description: "Autopilot run result" },
        },
      },
    },
    "/posts/generate": {
      post: {
        tags: ["Posts"],
        summary: "Generate caption + image for platform",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
        },
        responses: {
          "200": { description: "Generated post" },
        },
      },
    },
    "/drafts": {
      get: {
        tags: ["Drafts"],
        summary: "List user drafts",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Draft list" },
        },
      },
      post: {
        tags: ["Drafts"],
        summary: "Create draft",
        security: [{ bearerAuth: [] }],
        responses: {
          "201": { description: "Draft created" },
        },
      },
    },
    "/drafts/{id}": {
      patch: {
        tags: ["Drafts"],
        summary: "Update draft",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "integer" } }],
        responses: {
          "200": { description: "Draft updated" },
        },
      },
      delete: {
        tags: ["Drafts"],
        summary: "Delete draft",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "integer" } }],
        responses: {
          "204": { description: "Deleted" },
        },
      },
    },
    "/usage/me": {
      get: {
        tags: ["Usage"],
        summary: "Current month usage metrics",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Usage summary" },
        },
      },
    },
  },
};
