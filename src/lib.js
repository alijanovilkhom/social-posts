export const PLATFORMS = [
  {
    id: "telegram",
    label: "Telegram",
    hint: "канал и посты",
    accent: "#3cb4e5",
  },
  {
    id: "youtube",
    label: "YouTube",
    hint: "название и описание",
    accent: "#ff5a5a",
  },
  {
    id: "instagram",
    label: "Instagram",
    hint: "хук и карусель текста",
    accent: "#ff7ab6",
  },
];

export function platformById(id) {
  return PLATFORMS.find((item) => item.id === id) || PLATFORMS[0];
}

export const TONES = [
  { id: "engaging", label: "Вовлекающий" },
  { id: "selling", label: "Продающий" },
  { id: "humor", label: "Юмор" },
  { id: "expert", label: "Экспертный" },
  { id: "friendly", label: "Дружелюбный" },
  { id: "bold", label: "Дерзкий" },
];

export function toneById(id) {
  return TONES.find((item) => item.id === id) || TONES[0];
}

export function formatFullPost(post, platform) {
  const title = post.title?.trim() || "";
  const body = post.body?.trim() || "";
  const cta = post.cta?.trim() || "";
  const hashtags = post.hashtags?.trim() || "";

  if (platform === "youtube") {
    return [title, "", body, "", cta, "", hashtags].filter((line, i, arr) => {
      if (line !== "") return true;
      return arr[i - 1] !== "" && i !== arr.length - 1;
    }).join("\n").trim();
  }

  return [title, "", body, "", cta, "", hashtags].join("\n").trim();
}

export async function copyText(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  }
}
