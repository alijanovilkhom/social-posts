export async function fetchHealth() {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error("Сервер недоступен");
  return res.json();
}

export async function generatePosts({
  topic,
  platform,
  count = 3,
  extra = "",
  startIndex = 0,
  angleOffset = 0,
  tone = "engaging",
  onEvent,
  signal,
}) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topic, platform, count, extra, startIndex, angleOffset, tone }),
    signal,
  });

  if (!res.ok) {
    let message = "Не удалось запустить генерацию";
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Браузер не поддерживает потоковый ответ");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const line = part
        .split("\n")
        .filter((row) => row.startsWith("data:"))
        .map((row) => row.slice(5).trim())
        .join("");
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        /* skip broken chunks */
      }
    }
  }
}
