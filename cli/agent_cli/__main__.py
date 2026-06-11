"""Agent CLI:终端里的瘦客户端。agent login / machines / chat / approvals。"""

import argparse
import asyncio
import getpass
import sys

from . import config
from .client import AgentClient, ApiError


def _client(require_token: bool = True) -> AgentClient:
    cfg = config.load()
    if not cfg.get("server_url"):
        sys.exit("未登录。先运行: agent login <server_url>")
    if require_token and not cfg.get("token"):
        sys.exit("未登录。先运行: agent login")
    return AgentClient(cfg["server_url"], cfg.get("token"))


async def cmd_login(args) -> None:
    server_url = args.server_url or config.load().get("server_url")
    if not server_url:
        server_url = input("Server 地址 (如 http://192.168.1.143:8700): ").strip()
    username = args.username or input("用户名: ").strip()
    password = getpass.getpass("密码: ")
    client = AgentClient(server_url)
    res = await client.login(username, password)
    config.save({"server_url": server_url, "token": res["token"], "user": res["user"]})
    print(f"✓ 已登录为 {res['user']['username']} ({res['user']['role']}) @ {server_url}")


async def cmd_logout(args) -> None:
    cfg = config.load()
    if cfg.get("token"):
        await AgentClient(cfg["server_url"], cfg["token"]).logout()
    config.clear()
    print("✓ 已登出")


async def cmd_whoami(args) -> None:
    me = await _client().me()
    print(f"{me['username']} ({me['role']})")


async def cmd_machines(args) -> None:
    rows = await _client().machines()
    if not rows:
        print("(无机器)")
        return
    for m in rows:
        dot = "🟢" if m["status"] == "online" else "⚪"
        print(f"{dot} {m['machine_name']:<24} {m.get('os') or '?':<8} {m['status']:<8} {len(m.get('capabilities') or [])} 工具  {m['machine_id']}")


async def cmd_approvals(args) -> None:
    rows = await _client().approvals()
    if not rows:
        print("(无待审批)")
        return
    for a in rows:
        cmd = (a.get("payload") or {}).get("command", "")
        print(f"⚠ {a['approval_id']}  规则={a['risk_rule']}  机器={a['machine_id']}\n   {a['tool']}: {cmd}")
    print("\n批准: agent approve <id>   拒绝: agent reject <id>")


async def cmd_approve(args) -> None:
    r = await _client().approve(args.approval_id)
    print(f"✓ 已批准,任务 {r.get('task_id')} ({r.get('task_status')})")


async def cmd_reject(args) -> None:
    await _client().reject(args.approval_id)
    print("✓ 已拒绝")


def _on_event(ev: dict) -> None:
    t = ev.get("type")
    if t == "assistant" and (ev.get("content") or "").strip():
        print(f"\n助手 > {ev['content']}")
    elif t == "tool_call":
        print(f"  → 调用 {ev['tool']}({_short(ev.get('arguments'))})")
    elif t == "tool_output":
        sys.stdout.write(ev.get("data", ""))
        sys.stdout.flush()
    elif t == "tool_result":
        print(f"  [{ev.get('status')}]")
    elif t == "approval_required":
        print(f"  ⚠ 命中高危「{ev.get('risk_rule')}」,需审批 {ev.get('approval_id')}(另开终端 agent approve)")
    elif t == "turn_error":
        print(f"  ✗ 模型错误: {ev.get('message')}")


def _short(args) -> str:
    s = str(args or {})
    return s if len(s) <= 60 else s[:57] + "..."


async def cmd_chat(args) -> None:
    client = _client()
    rows = await client.machines()
    target = next((m for m in rows if args.machine in (m["machine_name"], m["machine_id"])), None)
    if target is None:
        sys.exit(f"未找到机器 {args.machine}(agent machines 查看)")
    if target["status"] != "online":
        sys.exit(f"机器 {target['machine_name']} 不在线")
    session = await client.create_session(target["machine_id"])
    sid = session["session_id"]
    print(f"● 对话已开 @ {target['machine_name']}(会话 {sid})。输入消息;exit 退出。\n")
    loop = asyncio.get_event_loop()
    while True:
        try:
            content = (await loop.run_in_executor(None, input, "你 > ")).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not content:
            continue
        if content in ("exit", "quit", ":q"):
            break
        try:
            await client.send_and_stream(sid, content, _on_event)
            print()
        except ApiError as e:
            print(f"✗ {e}")


def main() -> None:
    p = argparse.ArgumentParser(prog="agent", description="Department Agent 终端客户端")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("login", help="登录")
    sp.add_argument("server_url", nargs="?")
    sp.add_argument("-u", "--username")
    sp.set_defaults(func=cmd_login)

    sub.add_parser("logout", help="登出").set_defaults(func=cmd_logout)
    sub.add_parser("whoami", help="当前用户").set_defaults(func=cmd_whoami)
    sub.add_parser("machines", help="列出机器").set_defaults(func=cmd_machines)
    sub.add_parser("approvals", help="待审批").set_defaults(func=cmd_approvals)

    sp = sub.add_parser("approve", help="批准")
    sp.add_argument("approval_id")
    sp.set_defaults(func=cmd_approve)

    sp = sub.add_parser("reject", help="拒绝")
    sp.add_argument("approval_id")
    sp.set_defaults(func=cmd_reject)

    sp = sub.add_parser("chat", help="对话(模型驱动远程机器)")
    sp.add_argument("-m", "--machine", required=True, help="机器名或 id")
    sp.set_defaults(func=cmd_chat)

    args = p.parse_args()
    try:
        asyncio.run(args.func(args))
    except ApiError as e:
        sys.exit(f"✗ {e}")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
