# T-PKG-01:Runner 打单文件可执行(PyInstaller)

> 执行者:Codex。**受控例外**:允许在 `runner/` 内**新增打包文件**,但
> **严禁修改 `runner/agent_runner/` 下任何现有运行时代码**(尤其 secure_path.py / tools.py / client.py)。
> 不得改动 `server/`、`docs/`、`web/`。纯打包,不改逻辑。

## 1. 目标

把 Runner 打成**单文件可执行**,让员工机器无需安装 Python/uv 即可运行。部署第一痛点。

## 2. 安全护栏(硬约束,违反即不通过)

- 只能**新增**打包相关文件(入口 shim、PyInstaller spec、构建脚本、文档),
  **不改** `agent_runner/` 内任何 .py 的逻辑(路径校验、幂等缓存、工具实现一字不动)。
- 不引入会改变运行时行为的依赖;allowed_roots/blocked_paths 仍只来自本地 config。

## 3. 做什么

- `runner/` 加 PyInstaller 到 dev 依赖;新增入口 shim(如 `runner/entry.py`:`from agent_runner.__main__ import main; main()`)。
- 提供 PyInstaller spec 或 `runner/build_binary.py`,产出单文件可执行 `agent-runner`(Win 为 `agent-runner.exe`)。
- 可执行仍接受 `--config config.yaml --state runner_state.json`,运行时行为与 `python -m agent_runner` 完全一致。
- 更新 `runner/README.md`:如何构建、如何在无 Python 机器上运行。

## 4. 验收标准

1. 在当前开发机(macOS)构建出单文件 `agent-runner`,`./agent-runner --config config.yaml` 能注册、心跳、执行 remote_exec(可对着本地 `scripts/dev_up.sh` 起的 Server 验证)
2. 二进制内不依赖系统已装 Python
3. `runner/` 既有 `pytest` 仍全绿;`agent_runner/` 运行时代码**零改动**(`git diff` 只见新增打包文件)
4. README 写明三平台构建方式(至少 macOS 实测,Win/Linux 配置就绪)

## 5. 明确不做

代码签名/公证、自动更新、改任何运行时逻辑、Go 重写(后续)。
