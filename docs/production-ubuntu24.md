# Production на Ubuntu 24.04 (без Docker)

Схема: **BIND9** (системный) + **backend** (127.0.0.1:8000) + **frontend** (127.0.0.1:3000) + **nginx** (80/443) + **PM2**.

```
Браузер → nginx :443/:80
            ├─ /      → Next.js :3000
            └─ /api/  → FastAPI :8000
Backend → rndc / zone-файлы → BIND :53
```

---

## 1. Подготовка VPS

```bash
sudo apt update && sudo apt upgrade -y
```

Скопируйте проект в `/opt/dns-editor` (git clone, scp или unzip архива).

---

## 2. Node.js LTS и npm (Ubuntu 24.04)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # v22.x
npm -v
```

---

## 3. Зависимости для backend и BIND

```bash
sudo apt install -y python3 python3-venv python3-pip \
  bind9 bind9utils bind9-dnsutils nginx
```

Утилиты `named-checkzone`, `rndc`, `dig` нужны backend.

---

## 4. Права на zone-файлы

```bash
sudo mkdir -p /etc/bind/zones/keys
sudo cp /opt/dns-editor/zones/db.* /etc/bind/zones/ 2>/dev/null || true
sudo cp /opt/dns-editor/config/named.conf.local /etc/bind/named.conf.local
sudo chown -R root:bind /etc/bind/zones
sudo chmod 775 /etc/bind/zones
sudo usermod -aG bind dnseditor   # пользователь создаётся скриптом
```

Проверка BIND:

```bash
sudo named-checkconf
sudo systemctl restart named
sudo rndc status
```

---

## 5. Конфигурация окружения

```bash
sudo cp /opt/dns-editor/deploy/production.env.example /opt/dns-editor/deploy/production.env
sudo nano /opt/dns-editor/deploy/production.env
```

Пример:

```env
ADMIN_USER=admin
ADMIN_PASSWORD=ваш_пароль
SECRET_KEY=$(openssl rand -hex 32)

BIND_HOST=127.0.0.1
ZONES_DIR=/etc/bind/zones
BIND_DIR=/etc/bind

CORS_ORIGINS=https://ваш-домен.ru
NEXT_PUBLIC_API_URL=https://ваш-домен.ru/api
```

---

## 6. Backend (localhost:8000)

```bash
cd /opt/dns-editor/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Проверка вручную:
set -a && source ../deploy/production.env && set +a
uvicorn main:app --host 127.0.0.1 --port 8000
```

API **не** публикуется наружу — только `127.0.0.1`.

---

## 7. Frontend (localhost:3000)

```bash
cd /opt/dns-editor/frontend
export NEXT_PUBLIC_API_URL=https://ваш-домен.ru/api
npm ci
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true

# Проверка:
cd .next/standalone && HOSTNAME=127.0.0.1 PORT=3000 node server.js
```

---

## 8. PM2 — автозапуск

```bash
sudo npm install -g pm2
cd /opt/dns-editor
sudo -u dnseditor pm2 start deploy/ecosystem.config.cjs
sudo -u dnseditor pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u dnseditor --hp /opt/dns-editor
```

Полезные команды:

```bash
sudo -u dnseditor pm2 status
sudo -u dnseditor pm2 logs
sudo -u dnseditor pm2 restart all
```

---

## 9. nginx — 80/443 и прокси на /api

```bash
sudo cp /opt/dns-editor/deploy/nginx-dns-editor.conf /etc/nginx/sites-available/dns-editor
sudo nano /etc/nginx/sites-available/dns-editor   # замените dns.example.com
sudo ln -sf /etc/nginx/sites-available/dns-editor /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS (Let's Encrypt):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ваш-домен.ru
```

После certbot раскомментируйте блок `server { listen 443 ... }` в конфиге или доверьтесь автоправкам certbot.

---

## 10. Автоматическая установка (всё сразу)

```bash
cd /opt/dns-editor
chmod +x scripts/deploy.sh
sudo bash scripts/deploy.sh --mode native --url https://ваш-домен.ru
```

Или интерактивно: `sudo bash scripts/deploy.sh` → выбрать **2) native**.

---

## 11. Проверка

```bash
curl -s http://127.0.0.1:8000/
curl -s http://127.0.0.1:3000/ | head
curl -s https://ваш-домен.ru/api/
curl -sI https://ваш-домен.ru/
sudo -u dnseditor pm2 status
dig @127.0.0.1 ваш-домен.ru NS +short
```

---

## Важно

| Тема | Решение |
|------|---------|
| API снаружи | Закрыт; доступ только `https://домен/api/` через nginx |
| Пересборка фронта после смены URL | `npm run build` с новым `NEXT_PUBLIC_API_URL` + `pm2 restart dns-frontend` |
| Docker vs native | В Docker задайте `BIND_HOST=dns-server` в compose |
| DNS порт 53 | Обслуживает системный `named`, не Node |
