# V4.0.0 服务器部署交接文档

## 一、项目概览

这是一个多人空间语音聊天室 PWA，刚完成从美国云服务到国内自建服务器的迁移。

| 组件 | 以前 | 现在 |
|------|------|------|
| 网页托管 | GitHub Pages (美国) | nginx @ 49.233.177.94 |
| 语音通话 | LiveKit Cloud (新加坡) | LiveKit Server @ 49.233.177.94 |
| 房间发现 | emqx.io (公共) | Mosquitto @ 49.233.177.94 |

## 二、GitHub 仓库

```
仓库: https://github.com/MiraiYoki/voice2
本地路径: C:/Users/YUKI/voice2
当前分支: main
```

### 关键文件（已改但未推送）

| 文件 | 改了什么 | 推送状态 |
|------|---------|---------|
| `src/secrets.js` | LiveKit URL/KEY/SECRET 换成自建服务器 | ❌ 未推送（在.gitignore里） |
| `src/config.js` | MQTT_URLS 首位换成 `ws://49.233.177.94:9001` | ✅ 已推送 |
| `.gitignore` | 加了 `src/secrets.js` | ✅ 已推送 |
| `deploy/` 文件夹 | docker-compose/livekit/nginx/mosquitto 配置 | ✅ 已推送 |

### secrets.js 当前内容（本地）

```js
export const LIVEKIT_URL    = 'ws://49.233.177.94:7880';
export const LIVEKIT_KEY    = 'API...';  // 查看 C:/Users/YUKI/voice2/src/secrets.js
export const LIVEKIT_SECRET = '...';     // 查看 C:/Users/YUKI/voice2/src/secrets.js
```

**这个文件不能推送到 GitHub**（密钥会泄露），已加入 .gitignore。部署到服务器时通过 SCP 直接传。

## 三、服务器信息

```
IP: 49.233.177.94
云厂商: 腾讯云轻量应用服务器
地域: 北京
配置: 2核2G 3M
系统: Ubuntu 22.04
SSH 用户: ubuntu
SSH 密钥: C:/Users/YUKI/Desktop/WIN.pem
SSH 命令: ssh -i C:/Users/YUKI/Desktop/WIN.pem ubuntu@49.233.177.94
```

### 服务器目录结构

```
/home/ubuntu/
  ├── deploy/              ← docker-compose 和服务配置
  │   ├── docker-compose.yml
  │   ├── livekit.yaml      ← LiveKit 密钥配置
  │   ├── nginx.conf
  │   ├── mosquitto.conf
  │   └── setup.sh
  ├── docs/                ← 静态网页文件（nginx 通过 docker volume 挂载到这里）
  │   ├── index.html
  │   ├── assets/
  │   ├── maps/            ← 3张地图（宫廷/庭院/庭院房间）
  │   ├── music/           ← 4首音乐
  │   └── sfx/             ← 16个音效
  ├── public/
  │   ├── maps/
  │   ├── music/
  │   └── sfx/
  └── deploy-package.tar.gz
```

### Docker 容器

```bash
cd ~/deploy && sudo docker compose ps

# 四个容器:
# deploy-livekit-1     端口 7880-7882  语音SFU
# deploy-redis-1       端口 6379      LiveKit依赖
# deploy-mosquitto-1   端口 9001      MQTT房间发现
# deploy-nginx-1       端口 80        网页托管
```

常用命令：
```bash
cd ~/deploy
sudo docker compose ps          # 查看状态
sudo docker compose restart X   # 重启某服务
sudo docker compose logs X      # 查看日志
sudo docker compose down        # 停止
sudo docker compose up -d       # 启动
```

## 四、需要做的事

### 优先级 P0（必须做）

1. **推送最新代码到 GitHub**
   - 本地在 `C:/Users/YUKI/voice2`
   - `npm run build` 构建
   - `git status` 确认有未推送的提交
   - `git push origin main` 推送到 GitHub

2. **把 secrets.js 上传到服务器**
   - 服务器缺少有效的 secrets.js（当前用了占位符）
   - SCP 上传: `scp -i WIN.pem src/secrets.js ubuntu@49.233.177.94:~/voice2/src/secrets.js`

3. **测试网页访问**
   - 浏览器打开 `http://49.233.177.94`
   - 应该看到 voice2 首页

4. **测试完整功能**
   - 创建房间 → 是否能成功
   - 另一个设备加入 → 能否互相听到
   - 切换地图 → 是否加载新地图
   - 播放音乐/音效 → 是否正常

### 优先级 P1（重要）

5. **腾讯云防火墙开放 UDP 端口**
   - 控制台 → 轻量服务器 → 防火墙 → 添加规则
   - 协议 UDP，端口 7881-7882，允许所有 IP
   - WebRTC 语音需要 UDP 通道

6. **配置 HTTPS**（备案后）
   - 备案下来后申请 SSL 证书
   - 或使用 Caddy 替代 nginx（自动 Let's Encrypt）
   - 注意：LiveKit URL 要从 `ws://` 改为 `wss://`

7. **域名备案**
   - 如果域名是买的，需要在北京通信管理局备案
   - 备案下来后才能用域名访问

### 优先级 P2（优化）

8. **Docker 镜像加速**
   - 当前配置在 `/etc/docker/daemon.json`
   - 如果镜像源失效，换其他国内源

9. **自动重启**
   - `docker compose` 已配置 `restart: unless-stopped`
   - 服务器重启后容器应自动启动，需要验证

10. **监控和日志**
    - `sudo docker compose logs -f` 实时看日志
    - 关注 LiveKit 容器是否有错误

## 五、故障排查

| 问题 | 检查点 |
|------|--------|
| 网页打不开 | `sudo docker compose ps` nginx 是否 Up |
| 创建房间失败 | `sudo docker compose logs livekit` 看密钥是否有效 |
| 听不到声音 | 防火墙 UDP 7881-7882 是否开放 |
| 看不到房间列表 | Mosquitto 是否正常 `sudo docker compose logs mosquitto` |
| Git 推送被拒 | secrets.js 是否在 .gitignore 里 |
| 地图/音乐 404 | 文件是否在 `~/docs/` 下 |
