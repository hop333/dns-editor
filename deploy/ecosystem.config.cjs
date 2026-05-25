/**
 * PM2: backend (uvicorn) + frontend (Next.js standalone).
 * Запуск из /opt/dns-editor:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup systemd -u dnseditor --hp /opt/dns-editor
 */
module.exports = {
  apps: [
    {
      name: "dns-backend",
      cwd: "/opt/dns-editor/backend",
      script: "/opt/dns-editor/backend/.venv/bin/uvicorn",
      args: "main:app --host 127.0.0.1 --port 8000",
      interpreter: "none",
      env_file: "/opt/dns-editor/deploy/production.env",
      autorestart: true,
      max_restarts: 10,
      watch: false,
    },
    {
      name: "dns-frontend",
      cwd: "/opt/dns-editor/frontend",
      script: "node",
      args: ".next/standalone/server.js",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
      },
      env_file: "/opt/dns-editor/deploy/production.env",
      autorestart: true,
      max_restarts: 10,
      watch: false,
    },
  ],
};
