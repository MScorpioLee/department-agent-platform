import asyncio

from app.registry import RunnerHub


async def test_hub_expect_resolve_wakes_waiter():
    hub = RunnerHub(1024)
    hub.expect("t1")

    async def resolver():
        await asyncio.sleep(0.05)
        hub.resolve("t1")

    asyncio.create_task(resolver())
    assert await hub.wait("t1", timeout=1.0) is True
    assert "t1" not in hub.task_waiters  # 已清理


async def test_hub_wait_timeout_returns_false():
    hub = RunnerHub(1024)
    hub.expect("t2")
    assert await hub.wait("t2", timeout=0.1) is False
    assert "t2" not in hub.task_waiters


async def test_hub_wait_unknown_task_returns_true():
    # 没有 expect 过的任务(如 fire-and-forget),wait 立即返回
    hub = RunnerHub(1024)
    assert await hub.wait("nope", timeout=0.1) is True


async def test_hub_resolve_before_wait():
    hub = RunnerHub(1024)
    hub.expect("t3")
    hub.resolve("t3")  # 结果先到
    assert await hub.wait("t3", timeout=0.1) is True
