"use client";

import { useState } from "react";
import { Playground } from "../../components/playground";

export function CasePlayground({ source: initial, file }: { source: string; file: string }) {
  const [source, setSource] = useState(initial);
  const [tab, setTab] = useState<"proof" | "run">("proof");
  return <Playground source={source} onSource={setSource} tab={tab} onTab={setTab} runKey={0} file={file} />;
}
