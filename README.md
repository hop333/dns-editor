# DNS Editor

Self-hosted web panel for managing BIND DNS zones.

DNS Editor lets you edit DNS records in a browser, validate the zone with
`named-checkzone`, save the source zone file, reload BIND with `rndc`, and manage
DNSSEC DS records for registrar setup.

## Features

- BIND 9 authoritative DNS server.
- FastAPI backend with JWT authentication.
- Next.js web interface.
- Zone record editing: `A`, `AAAA`, `CNAME`, `MX`, `NS`, `TXT`, `SRV`.
- Server-side validation before writing zone files.
- DNSSEC enable/disable workflow and DS record display.
- Docker Compose stack for local testing.
- Production stack with Caddy reverse proxy and HTTPS.

## Recommended Production Layout

Do not expose the admin panel on the same hostname as the public website.

Example:

| Hostname | Purpose |
|---|---|
| `example.com` | Public site or landing page |
| `dns.example.com` | DNS Editor admin panel |
| `ns1.example.com` | Authoritative nameserver, A record points to the VPS |
| `ns2.example.com` | Authoritative nameserver, A record points to the VPS |

The same VPS can host all of this. Caddy or nginx routes traffic by hostname:
the public domain serves the static site, while the panel subdomain serves DNS
Editor.

In the production Docker setup, HTTPS is provided by the `caddy` service from
`deploy/docker-compose.prod.yml`. Caddy publishes only `80/443`, gets Let's
Encrypt certificates, serves `site/` on the public hostname, and proxies the
panel hostname to the frontend plus `/api` to the backend.

## Quick Start For Local Development

```bash
cp .env.example .env
docker compose up -d --build
```

Open:

- UI: <http://localhost:3000>
- API: <http://localhost:8000>

Default local credentials are `admin` / `admin`. Change them before any public
deployment.

If BIND cannot read `config/rndc.key`, regenerate it:

```bash
docker run --rm -v "$PWD/config:/etc/bind" ubuntu/bind9:latest \
  rndc-confgen -a -A hmac-sha256 -c /etc/bind/rndc.key
chmod 644 config/rndc.key
```

## Production Install

Use the public GitHub repository:

```bash
curl -fsSL https://raw.githubusercontent.com/hop333/dns-editor/main/deploy/install.sh \
  | sudo bash -s -- \
      --repo https://github.com/hop333/dns-editor.git \
      --domain dns.example.com \
      --site-domain example.com \
      --email admin@example.com
```

For an IP-only test without HTTPS:

```bash
sudo bash deploy/install.sh \
  --repo https://github.com/hop333/dns-editor.git \
  --domain 203.0.113.10 \
  --http-only
```

More details: [docs/INSTALL.md](docs/INSTALL.md).

## Production Docker Compose

Manual production start:

```bash
cp deploy/Caddyfile.site.example deploy/Caddyfile
cp deploy/docker.env.example .env
# edit .env and deploy/Caddyfile
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
```

In production, only ports `53`, `80`, and `443` should be public. Backend `8000`
and frontend `3000` stay inside the Docker network and are exposed only through
Caddy.

## DNSSEC

DNSSEC can be enabled per zone in the UI:

1. Save the zone.
2. Enable DNSSEC.
3. Reload BIND.
4. Copy DS records from the DNSSEC panel.
5. Add DS records at the domain registrar.

The chain of trust is complete only after DS records are added at the registrar.
To roll back, disable DNSSEC in the panel and remove DS records at the registrar.

## Useful Checks

```bash
docker compose ps
docker compose logs -f
dig @127.0.0.1 mydomain.ru A +short
dig @YOUR_SERVER_IP example.com A +short
```

Frontend checks:

```bash
cd frontend
npm ci
npm run lint
npm run build
```

## Repository Structure

```text
backend/      FastAPI backend and BIND/DNSSEC integration
frontend/     Next.js UI
config/       BIND config templates
zones/        Example/source zone files
deploy/       Production compose, Caddy, install/update/backup scripts
docs/         Install, security, troubleshooting, thesis notes
scripts/      Development and legacy deployment helpers
site/         Static public site example
```

## Security

Never commit real secrets or generated runtime files:

- `.env`
- `config/rndc.key`
- `zones/keys/`
- `zones/*.signed`
- `zones/*.jnl`
- `dist/`

Read [docs/SECURITY.md](docs/SECURITY.md) before exposing the panel to the
Internet.

Before publishing to GitHub, use [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## Current Architecture Note

The backend is currently implemented mostly in one file, `backend/main.py`.
That is acceptable for a diploma MVP and a small self-hosted project, but the
next open-source milestone should split it into modules:

- `models.py`
- `auth.py`
- `bind_service.py`
- `zone_service.py`
- `dnssec_service.py`
- `routers/`

This will make testing and external contributions much easier.

## License

MIT. See [LICENSE](LICENSE).
