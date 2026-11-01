# Deployment

## Database - MongoDB Atlas
Create a cluster and user (see README). For production, restrict Network Access to your host's egress IPs where possible.

## API - Render (Web Service)
- Root directory: repo root. Build: `npm install && npm run build -w server`. Start: `npm run start -w server`.
- Environment: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET` (32+ random chars), `CLIENT_URL=https://<your-client-domain>`.
- Health check path: `/api/health`.
- In production cookies are `Secure` + `SameSite=None` (client and API on different domains) and the API trusts one proxy hop. Only `CLIENT_URL` is allowed by CORS.

## Client - Vercel (or Render Static Site)
- Root directory: `client`. Build: `npm run build`. Output: `dist`.
- Environment: `VITE_API_URL=https://<your-api-domain>`.
- Add a rewrite of all paths to `/index.html` (SPA routing). On Vercel: `vercel.json` -> `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`.

## Checklist
1. Deploy API, confirm `GET /api/health` shows `db: connected`.
2. Deploy client with `VITE_API_URL`, set API `CLIENT_URL` to the client URL, redeploy API.
3. Register a user and create a workspace. Never run the seed script in production (it refuses to).

## Not implemented
Email delivery, file storage, scheduled reminders, AI provider - no configuration is needed for them yet.
