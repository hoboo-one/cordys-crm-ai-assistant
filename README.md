# Cordys CRM AI 小助手

在本机 Cordys CRM 中接入 AI 小助手和跟进待办。销售可以查询订单与包裹、追问物流异常，并在授权范围内委托助手创建待办，在 CRM 里记录核实结果和复查物流。

Cordys CRM 由 Docker 启动官方镜像。订单、仓库和物流使用本仓库的模拟服务，便于本地联调。

## 项目结构

| 文件 | 用途 |
| --- | --- |
| `compose.yaml` | 启动 Cordys CRM、Python 助手和 Nginx |
| `assistant/assistant.py` | 接收对话、调用模型和业务接口、校验订单访问权限 |
| `assistant/followup.py` | 处理待办去重、核实结果和复查记录 |
| `assistant/widget.js` | AI 小助手面板和跟进待办页面 |
| `assistant/gateway.conf` | 配置 HTTP、HTTPS 和请求转发 |
| `mock-systems/` | 模拟接口、示例数据、接口说明和验证脚本 |

## 本地启动

1. 安装 Docker Desktop 或 Docker Engine 和 Compose。运行模拟接口的验证脚本还需要 Python 3。
2. 将根目录的 `.env.example` 复制为 `.env`。填写当前机器上的 DeepSeek Key 文件、服务器证书文件和服务器私钥文件路径。Key 文件只写实际密钥。用于本地 HTTPS 的证书应覆盖 `localhost`，并由访问端信任的 CA 签发。
3. 将 `mock-systems/crm-connections.example.json` 复制为同目录下的 `crm-connections.json`。为订单、仓库、物流各生成一个测试 Token，分别填入对应的 `token` 字段，并将相同的值分别写入 `mock-systems/tokens/orders.txt`、`warehouse.txt` 和 `logistics.txt`。
4. 创建 `assistant/state/` 目录，用于保存 SQLite 跟进记录。Linux 部署时需允许助手容器的 UID/GID `65534:65534` 写入该目录。
5. 在仓库根目录依次运行：

```bash
docker compose config --quiet
docker compose up -d
docker compose -f mock-systems/compose.yaml -f mock-systems/compose.crm.yaml up -d
```

打开 [HTTPS 入口](https://localhost:8443) 或 [HTTP 调试入口](http://127.0.0.1:8081)，用测试账号登录。两个入口默认只绑定本机地址。重新搭建 CRM 数据库时，在 CRM 中创建测试客户，再把 `assistant/customer-map.json` 中的值对应到新环境里的 CRM 客户 ID。

## 验证功能

- 运行 `python mock-systems/verify.py` 检查模拟订单、包裹和物流接口是否返回预期数据。
- 打开右上角「AI 小助手」，用有权限的测试账号查询 `O-103`。这笔订单有两票运单，其中一票只有电子面单。继续问「第二个包裹要不要跟进」可以测试上下文。
- 需要执行时明确委托「帮我跟进 O-103」。在左侧「跟进待办」核对待办编号、核实结果和复查记录。换成无权访问该订单的测试账号时，应无法查询或建单。

查看助手和网关日志：

```bash
docker compose logs --tail 50 assistant
docker compose logs --tail 50 gateway
```

订单、仓库和物流接口的字段、测试数据和请求方式见 [模拟接口使用说明](mock-systems/接口与使用说明.md)。

真实密钥、TLS 私钥、业务 Token 和运行中的 SQLite 数据库由各运行环境保管。`.env.example` 和 `crm-connections.example.json` 仅包含配置样例。
