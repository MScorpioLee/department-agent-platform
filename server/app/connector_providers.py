"""连接器预设目录:常用 MCP server 的现成配置,供"添加连接器"一键选用(参考 Hermes 插件市场)。

选了预设自动填 command/args,提示需要哪些 env(凭据)。⚠ 运行=在服务端跑第三方代码,仅管理员、需信任来源。
"""

CONNECTOR_PRESETS = [
    {"id": "filesystem", "name": "Filesystem(本地文件)", "transport": "stdio",
     "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
     "env_keys": [], "note": "把 args 末尾改成允许访问的目录"},
    {"id": "fetch", "name": "Fetch(网页抓取)", "transport": "stdio",
     "command": "uvx", "args": ["mcp-server-fetch"], "env_keys": [], "note": "抓取网页为文本/markdown"},
    {"id": "github", "name": "GitHub", "transport": "stdio",
     "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
     "env_keys": ["GITHUB_PERSONAL_ACCESS_TOKEN"], "note": "需 GitHub PAT"},
    {"id": "slack", "name": "Slack", "transport": "stdio",
     "command": "npx", "args": ["-y", "@modelcontextprotocol/server-slack"],
     "env_keys": ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"], "note": "需 Slack Bot Token"},
    {"id": "postgres", "name": "PostgreSQL(只读)", "transport": "stdio",
     "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."],
     "env_keys": [], "note": "args 末尾填连接串;查询类用途"},
    {"id": "sqlite", "name": "SQLite", "transport": "stdio",
     "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "/path/to.db"],
     "env_keys": [], "note": "本地 SQLite 库"},
    {"id": "memory", "name": "Memory(知识图谱记忆)", "transport": "stdio",
     "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"], "env_keys": [], "note": "持久记忆"},
    {"id": "time", "name": "Time(时间/时区)", "transport": "stdio",
     "command": "uvx", "args": ["mcp-server-time"], "env_keys": [], "note": "时间与时区换算"},
    {"id": "brave_search", "name": "Brave Search(网页搜索)", "transport": "stdio",
     "command": "npx", "args": ["-y", "@modelcontextprotocol/server-brave-search"],
     "env_keys": ["BRAVE_API_KEY"], "note": "需 Brave API Key"},
    {"id": "custom", "name": "自定义", "transport": "stdio",
     "command": "", "args": [], "env_keys": [], "note": "手填 command/args 或远程 http url"},
]
