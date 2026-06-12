"""测试用的最小 MCP server(stdio),暴露一个 echo 工具。被 test_connectors 以子进程方式连接。"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("echo-test")


@mcp.tool()
def echo(text: str) -> str:
    return f"echo: {text}"


@mcp.tool()
def slow(seconds: float) -> str:
    """睡 seconds 秒后返回(测试调用超时用)。"""
    import time

    time.sleep(seconds)
    return "done"


if __name__ == "__main__":
    mcp.run()
