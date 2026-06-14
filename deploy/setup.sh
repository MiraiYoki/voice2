#!/bin/bash
# V4.0.0 — 服务器一键初始化 (在腾讯云Web终端粘贴运行)
set -e

echo "🚀 V4.0.0 部署开始..."

# 1. Docker
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | bash
  systemctl enable --now docker
fi

# 2. 拉取项目
cd /root
if [ ! -d voice2 ]; then
  git clone https://github.com/MiraiYoki/voice2.git
fi
cd voice2
git pull origin main

# 3. 生成 LiveKit 密钥
echo "🔑 生成 LiveKit 密钥..."
docker pull livekit/livekit-server:latest -q
KEYS=$(docker run --rm livekit/livekit-server generate-keys 2>/dev/null)
echo "$KEYS"
API_KEY=$(echo "$KEYS" | grep "API Key" | awk '{print $NF}' || echo "devkey")
API_SECRET=$(echo "$KEYS" | grep "Secret" | awk '{print $NF}' || echo "secret")

# 4. 写入 livekit.yaml
cat > deploy/livekit.yaml << EOF
port: 7880
rtc:
  udp_port: 7882
  tcp_port: 7881
  use_external_ip: true
redis:
  address: redis:6379
keys:
  $API_KEY: $API_SECRET
EOF

# 5. 启动
cd deploy
docker compose pull -q
docker compose up -d
sleep 5

# 6. 检查
echo ""
echo "✅ 部署完成！"
echo "访问: http://49.233.177.94"
docker compose ps

# 7. 更新本地密钥
echo ""
echo "⚠️ 复制下面两行到本地 src/secrets.js："
echo "export const LIVEKIT_KEY    = '$API_KEY';"
echo "export const LIVEKIT_SECRET = '$API_SECRET';"
