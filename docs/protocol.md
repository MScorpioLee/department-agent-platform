# Runner 通信协议

## 注册

Runner -> Server:

```json
{
  "type": "register",
  "machine_name": "alice-laptop",
  "os": "windows",
  "runner_version": "0.1.0",
  "capabilities": ["remote_exec", "remote_read_file", "remote_write_file"]
}
```

Server -> Runner:

```json
{
  "type": "registered",
  "machine_id": "m_123"
}
```

## 心跳

```json
{
  "type": "heartbeat",
  "machine_id": "m_123",
  "status": "idle",
  "current_task_id": null
}
```

## 任务下发

```json
{
  "type": "task",
  "task_id": "t_001",
  "tool": "remote_exec",
  "payload": {
    "workdir": "D:/projects/app",
    "command": "npm test",
    "timeout_seconds": 120
  }
}
```

## 结果回传

```json
{
  "type": "task_result",
  "task_id": "t_001",
  "status": "completed",
  "result": {
    "exit_code": 0,
    "stdout": "...",
    "stderr": "...",
    "duration_ms": 1000
  }
}
```
