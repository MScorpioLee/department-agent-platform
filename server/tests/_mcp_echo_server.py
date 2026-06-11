"""测试用的最小 MCP server(stdio),暴露一个 echo 工具。被 test_connectors 以子进程方式连接。"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("echo-test")


@mcp.tool()
def echo(text: str) -> str:
    return f"echo: {text}"


if __name__ == "__main__":
    mcp.run()
