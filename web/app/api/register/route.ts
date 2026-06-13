import { NextRequest, NextResponse } from "next/server";

import { getDefaultMockApi } from "@/lib/mock-api";
import { agentApiUrl, isRecord, readJsonBody, readResponseBody } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

function invalidRegister(message = "注册信息不完整") {
  return NextResponse.json(
    { error: { code: "validation_error", message } },
    { status: 422 }
  );
}

function readRegisterPayload(body: unknown) {
  if (!isRecord(body)) return null;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!username || !password) return null;
  return { username, password, display_name: displayName, note };
}

export async function POST(request: NextRequest): Promise<Response> {
  const payload = readRegisterPayload(await readJsonBody(request));
  if (!payload) {
    return invalidRegister("用户名和密码不能为空");
  }
  if (payload.password.length < 6) {
    return invalidRegister("password 最少 6 位");
  }

  if (process.env.MOCK_API === "1") {
    if (process.env.MOCK_NEEDS_SETUP === "1") {
      return NextResponse.json({
        status: "active",
        username: payload.username,
        role: "admin",
        bootstrap: true,
        message: "管理员账号已创建"
      });
    }

    const response = await getDefaultMockApi().handle("POST", ["register"], payload);
    return NextResponse.json(response.body, { status: response.status });
  }

  const upstream = await fetch(agentApiUrl("/register"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const body = await readResponseBody(upstream);
  return NextResponse.json(body, { status: upstream.status });
}
