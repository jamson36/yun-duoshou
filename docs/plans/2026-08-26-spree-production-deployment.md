# Spree 生产部署方案

> 日期：2026-08-26
> 产品展示名：让你花个爽！
> 技术标识：`spree`

## 目标拓扑

- 域名：`https://spree.jamson.top`
- 服务器目录：`/home/spree`
- 应用容器：`spree`
- 宿主机监听：`127.0.0.1:8787`
- HTTPS：宿主机 Caddy 终止 TLS，再反向代理至应用容器
- DNS：Cloudflare 托管；首次签发证书时先使用 DNS only，验证源站 HTTPS 后再开启代理
- 数据：用户消费记录仅保存在浏览器；服务器无业务数据库

## 密钥与运行边界

- DeepSeek 密钥只写入服务器 `/home/spree/.env`，权限为 `0600`，不进入镜像或前端资源。
- 没有密钥时，确定性人格评分仍可使用，AI 解释会明确进入降级状态。
- 容器以非 root 用户和只读文件系统运行，移除 Linux capabilities，并限制内存、CPU、进程数和日志大小。
- 8787 端口仅绑定本机回环地址，公网只开放 Caddy 的 80/443。

## 发布与回滚

发布：

```bash
cd /home/spree
docker compose -p spree up -d --build
```

健康检查：

```bash
curl --fail http://127.0.0.1:8787/api/health
```

回滚时使用服务器上保留的上一版目录或镜像重新执行 Compose；Caddy 修改脚本会在每次变更前把原配置备份为 `/etc/caddy/Caddyfile.bak-*-spree`，若重载失败会自动恢复。
