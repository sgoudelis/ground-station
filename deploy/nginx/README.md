# Nginx Reverse Proxy

Sample production config:

- `deploy/nginx/ground-station.conf.example`

Before use:

1. Replace `server_name` and certificate paths.
2. Ensure Ground Station is reachable at `127.0.0.1:7000` (or adjust upstream).
3. Keep these forwarded headers:
   - `X-Forwarded-Proto`
   - `X-Forwarded-Host`
   - `X-Forwarded-For`
4. Keep websocket upgrade headers:
   - `Upgrade`
   - `Connection`

Why these headers matter:

- Ground Station sets `Secure` auth cookies based on request scheme.
- Socket.IO requires websocket upgrade forwarding.
- Authenticated static data routes (`/recordings`, `/decoded`, `/audio`, `/transcriptions`) rely on session cookies reaching the backend.
