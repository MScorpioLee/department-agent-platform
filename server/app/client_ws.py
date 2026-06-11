"""浏览器/桌面端实时通道 /ws/client:票据鉴权 → 订阅某会话 → 实时收事件。"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .models import Session

router = APIRouter()
log = logging.getLogger(__name__)


@router.websocket("/ws/client")
async def client_ws(ws: WebSocket) -> None:
    app = ws.app
    user_id = app.state.tickets.consume(ws.query_params.get("ticket"))

    await ws.accept()
    if not user_id:
        await ws.close(code=4401)  # 票据无效/过期/已用
        return

    try:
        msg = await ws.receive_json()
    except WebSocketDisconnect:
        return
    session_id = msg.get("session_id")
    if msg.get("type") != "subscribe" or not session_id:
        await ws.close(code=4400)
        return

    # 访问控制:只能订阅自己的会话
    async with app.state.sessionmaker() as session:
        sess = await session.get(Session, session_id)
    if sess is None or sess.user_id != user_id:
        await ws.close(code=4403)
        return

    queue = app.state.events.subscribe(session_id)
    await ws.send_json({"type": "subscribed", "session_id": session_id})
    try:
        while True:
            event = await queue.get()
            await ws.send_json(event)  # 客户端断开时此处抛出,进入清理
    except WebSocketDisconnect:
        pass
    except Exception:  # 发送失败(连接已断)等
        pass
    finally:
        app.state.events.unsubscribe(session_id, queue)
