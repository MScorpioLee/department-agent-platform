import React from "react";

import { MachineAccessClient } from "@/app/machines/[id]/access/machine-access-client";

export function generateStaticParams() {
  return [{ id: "m_mock_online" }];
}

export default function MachineAccessPage({ params }: { params: { id: string } }) {
  return <MachineAccessClient machineId={params.id} />;
}
