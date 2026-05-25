# Чеклист релиза

Используйте этот список перед публикацией репозитория на GitHub.

## 1. Структура репозитория

Инициализируйте Git в корне проекта, а не внутри `frontend/`.

Проект должен быть одним репозиторием:

```text
dns-editor/
  backend/
  frontend/
  deploy/
  docs/
```

Если после ранних экспериментов остался `frontend/.git`, удалите или архивируйте
его до первого коммита из корня. Иначе Git может добавить `frontend` как вложенный
репозиторий, а не как обычную папку с файлами.

## 2. Не коммитить секреты и runtime-файлы

Эти файлы и каталоги не должны попасть в репозиторий:

```text
.env
config/rndc.key
zones/keys/
zones/*.signed
zones/*.jnl
dist/
backend/__pycache__/
frontend/.next/
frontend/node_modules/
```

Они добавлены в `.gitignore`, но перед коммитом всё равно проверьте:

```bash
git status --short
```

## 3. Обязательные проверки

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm run build
```

Docker Compose:

```bash
docker compose config
docker compose --env-file deploy/docker.env.example -f deploy/docker-compose.prod.yml config
```

Production-скрипты:

```bash
bash -n deploy/install.sh
bash -n deploy/update.sh
bash -n deploy/backup.sh
```

На Windows эти команды удобнее запускать через WSL, Git Bash или сразу на VPS.

## 4. Плейсхолдеры GitHub и доменов

Перед публичным релизом замените доменные и почтовые плейсхолдеры:

```text
admin@example.com
dns.example.com
example.com
```

В example-файлах часть плейсхолдеров может остаться специально. Но `README.md`,
сайт проекта и основные инструкции должны ссылаться на реальный GitHub-репозиторий,
когда он появится.

## 5. Первый коммит

```bash
git init
git add .
git status --short
git commit -m "Initial open-source release"
git branch -M main
git remote add origin https://github.com/hop333/dns-editor.git
git push -u origin main
```
