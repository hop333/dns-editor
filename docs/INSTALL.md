# Установка

DNS Editor рассчитан на самостоятельное размещение на небольшом VPS. Production-стек включает:

- BIND 9 как authoritative DNS-сервер.
- FastAPI backend для управления zone-файлами.
- Next.js frontend для веб-интерфейса.
- Caddy как reverse proxy с автоматическим HTTPS.

## Требования

- VPS на Ubuntu 22.04/24.04.
- Открытые публичные порты: `53/tcp`, `53/udp`, `80/tcp`, `443/tcp`.
- Поддомен для панели, например `dns.example.com`.
- Опционально: основной публичный домен, например `example.com`.

Не размещайте админ-панель на том же hostname, что и обычный сайт. Для production удобна такая схема:

| Hostname | Назначение |
|---|---|
| `example.com` | Публичный сайт или страница проекта |
| `dns.example.com` | Админ-панель DNS Editor |
| `ns1.example.com`, `ns2.example.com` | Authoritative nameserver'ы, указывающие на VPS |

Подробная инструкция по смене NS у регистратора находится в [DOMAIN_DELEGATION.md](DOMAIN_DELEGATION.md).

## HTTPS и Caddy

В production-режиме HTTPS обслуживает Caddy из `deploy/docker-compose.prod.yml`.
Caddy является единственной публичной веб-точкой входа:

- контейнер `caddy` публикует только `80/tcp` и `443/tcp`;
- `frontend:3000` и `backend:8000` доступны только внутри Docker-сети;
- запросы `/api/*` проксируются в FastAPI backend;
- остальные запросы к домену панели проксируются во frontend;
- сертификаты Let's Encrypt выпускаются автоматически, если указан настоящий домен и email.

Если на одном VPS должны жить и сайт, и DNS-панель, используйте два hostname:

```text
example.com      -> статический публичный сайт из site/
dns.example.com  -> панель DNS Editor
```

Так обычные посетители `example.com` не попадают на страницу авторизации панели,
а панель остаётся доступной на отдельном поддомене.

## Установка одной командой

Замените `OWNER/dns-editor` на реальный GitHub-репозиторий:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/dns-editor/main/deploy/install.sh \
  | sudo bash -s -- \
      --repo https://github.com/OWNER/dns-editor.git \
      --domain dns.example.com \
      --site-domain example.com \
      --email admin@example.com
```

Скрипт установки автоматически создаёт `.env`, генерирует пароль администратора
и `SECRET_KEY`, выставляет `.env` права `600` и показывает команду, которой можно
посмотреть пароль на сервере:

```bash
sudo grep ADMIN_PASSWORD /opt/dns-editor/.env
```

Для теста по IP без HTTPS:

```bash
sudo bash deploy/install.sh \
  --repo https://github.com/OWNER/dns-editor.git \
  --domain 203.0.113.10 \
  --http-only
```

## Ручной production-запуск

Минимальный вариант только с панелью:

```bash
cp deploy/Caddyfile.example deploy/Caddyfile
cp deploy/docker.env.example .env
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
```

Вариант для одного VPS, где есть и публичный сайт, и панель:

```bash
cp deploy/Caddyfile.site.example deploy/Caddyfile
cp deploy/docker.env.example .env
```

После этого отредактируйте `deploy/Caddyfile` и `.env`: замените `example.com`
на публичный домен сайта, а `dns.example.com` на поддомен панели. Caddy будет
отдавать статические файлы из `site/` на публичном домене и держать редактор на
отдельном домене панели.

## Полезные команды

```bash
docker compose --env-file .env -f deploy/docker-compose.prod.yml ps
docker compose --env-file .env -f deploy/docker-compose.prod.yml logs -f
dig @YOUR_SERVER_IP mydomain.ru A +short
```

## Обновление

```bash
cd /opt/dns-editor
sudo bash deploy/update.sh
```

## Резервная копия

```bash
sudo bash /opt/dns-editor/deploy/backup.sh
```
