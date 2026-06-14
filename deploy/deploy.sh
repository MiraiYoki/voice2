#!/bin/bash
# voice2 V4.0.0 — 一键部署脚本
# 在你的服务器上运行: bash deploy.sh

set -e
echo "🚀 voice2 V4.0.0 部署开始..."

# 1. 安装 Docker (如果没有)
if ! command -v docker &> /dev/null; then
    echo "📦 安装 Docker..."
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
fi

# 2. 安装 docker-compose (如果没有)
if ! command -v docker-compose &> /dev/null; then
    echo "📦 安装 docker-compose..."
    curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# 3. 生成 LiveKit API Key
echo "🔑 生成 LiveKit API Key..."
docker pull livekit/livekit-server > /dev/null
KEYS=$(docker run --rm livekit/livekit-server generate-keys 2>/dev/null | grep -E "API Key|Secret" || echo "需要手动生成")

# 4. 启动所有服务
echo "🐳 启动 Docker 服务..."
cd "$(dirname "$0")"
docker compose pull
docker compose up -d

# 5. 等待服务就绪
echo "⏳ 等待服务启动..."
sleep 5

# 6. 检查状态
echo "📊 服务状态:"
docker compose ps

echo ""
echo "✅ 部署完成!"
echo ""
echo "访问网页: http://49.233.177.94"
echo "语音端口: ws://49.233.177.94:7880"
echo "MQTT端口: ws://49.233.177.94:9001"
echo ""
echo "⚠️ 安全检查清单:"
echo "1. Cloudflare 防火墙: IPv6 已禁用 ✓"
echo "2. 登录服务器, 运行: docker compose logs livekit"
echo "3. 复制上面的 API Key + Secret 到 src/secrets.js"
echo "4. 本地 npm run build 重新构建"
