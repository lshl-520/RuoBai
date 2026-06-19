#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/lshl-520/RuoBai.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/www/wwwroot/ruobai}"
DOMAIN="${DOMAIN:-}"
APP_BIND="${APP_BIND:-127.0.0.1}"
APP_PORT="${APP_PORT:-3000}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-ruobai}"
ENABLE_VECTOR="${ENABLE_VECTOR:-0}"

DEFAULT_ADMIN_USERNAME="admin"
DEFAULT_ADMIN_PASSWORD="123456"
SPONSOR_GATEWAY_DOMAIN="maolaoapi.com"

log() {
  printf '\n\033[1;35m[RuoBai]\033[0m %s\n' "$1"
}

fail() {
  printf '\n\033[1;31m[RuoBai] 部署中止：%s\033[0m\n' "$1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  date +%s%N | sha256sum | awk '{print $1}'
}

normalize_domain() {
  printf '%s' "$1" \
    | sed 's#^https\?://##' \
    | sed 's#/$##'
}

make_cors_origins() {
  if [ -z "$DOMAIN" ]; then
    printf 'http://127.0.0.1:%s,http://localhost:%s' "$APP_PORT" "$APP_PORT"
    return
  fi

  local clean_domain
  clean_domain="$(normalize_domain "$DOMAIN")"
  printf 'https://%s,https://www.%s,http://%s,http://www.%s,http://127.0.0.1:%s' \
    "$clean_domain" "$clean_domain" "$clean_domain" "$clean_domain" "$APP_PORT"
}

log "检查运行环境"
need_cmd git
need_cmd docker
docker compose version >/dev/null 2>&1 || fail "缺少 docker compose。宝塔用户可先安装 Docker/Compose 插件后重试。"

log "准备安装目录：$INSTALL_DIR"
mkdir -p "$(dirname "$INSTALL_DIR")"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "检测到已有仓库，切到 $BRANCH 并拉取最新代码"
  git -C "$INSTALL_DIR" fetch origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
elif [ -e "$INSTALL_DIR" ] && [ "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 | wc -l)" -gt 0 ]; then
  fail "$INSTALL_DIR 已存在且不是空目录。请换 INSTALL_DIR，或先手动确认里面没有重要文件。"
else
  log "克隆项目代码"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
mkdir -p deploy

ENV_FILE="$INSTALL_DIR/deploy/.env"

if [ -f "$ENV_FILE" ]; then
  log "检测到已有 deploy/.env，保留原配置"
else
  log "生成 Docker 部署配置"
  MYSQL_ROOT_PASSWORD="$(gen_secret)"
  SESSION_SECRET="$(gen_secret)"
  CORS_ORIGINS="$(make_cors_origins)"

  cat > "$ENV_FILE" <<EOF
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME
DOMAIN=$DOMAIN
APP_BIND=$APP_BIND
APP_PORT=$APP_PORT
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD
DB_NAME=ruobai
SESSION_SECRET=$SESSION_SECRET
CORS_ORIGINS=$CORS_ORIGINS
BETA_REGISTRATION_ENABLED=true
OPEN_SOURCE_SINGLE_USER=false
VECTOR_QDRANT_URL=http://qdrant:6333
VECTOR_EMBEDDING_URL=http://embedding:80
VECTOR_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
VECTOR_COLLECTION=ruobai_memories
EOF
fi

log "启动 Docker 服务"
cd "$INSTALL_DIR/deploy"

if [ "$ENABLE_VECTOR" = "1" ]; then
  docker compose --profile vector up -d --build
else
  docker compose up -d --build
fi

log "当前容器状态"
docker compose ps

if [ -n "$DOMAIN" ]; then
  CLEAN_DOMAIN="$(normalize_domain "$DOMAIN")"
  SITE_URL="https://$CLEAN_DOMAIN"
else
  SITE_URL="http://127.0.0.1:$APP_PORT"
fi

cat <<EOF

================ RuoBai 部署完成 ================

访问地址：
  $SITE_URL

如果你使用宝塔面板，请把网站反向代理到：
  http://127.0.0.1:$APP_PORT

后台地址：
  $SITE_URL/admin
  （会自动进入 $SITE_URL/admin.html；未登录时打开后台登录）

默认管理员：
  用户名：$DEFAULT_ADMIN_USERNAME
  密码：$DEFAULT_ADMIN_PASSWORD

第一次登录后必须马上做：
  1. 进入后台 → 系统/管理员账号
  2. 把默认密码改掉
  3. 再去前台“我的 → 接口渠道”填写自己的模型接口

接口填写示例：
  DeepSeek 官方：
    类型：DeepSeek / OpenAI 兼容
    API 地址：https://api.deepseek.com
    模型：deepseek-chat
    密钥：填你自己的 DeepSeek Key

  赞助中转：
    域名：$SPONSOR_GATEWAY_DOMAIN
    API 地址：按赞助方后台给出的 OpenAI 兼容地址填写
    密钥：填你自己的中转 Key，不要发给别人

向量记忆：
  当前 ENABLE_VECTOR=$ENABLE_VECTOR
  第一次部署建议先不开。网站稳定后可用 ENABLE_VECTOR=1 重新运行本脚本。

================================================

EOF
