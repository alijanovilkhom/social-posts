const FIELD_TAGS = [
  { tag: "TITLE", key: "title" },
  { tag: "BODY", key: "body" },
  { tag: "CTA", key: "cta" },
  { tag: "HASHTAGS", key: "hashtags" },
  { tag: "IMAGE_PROMPT", key: "imagePrompt" },
];

export function parseLabeledPost(text) {
  const result = {
    title: "",
    body: "",
    cta: "",
    hashtags: "",
    imagePrompt: "",
  };

  if (!text) return result;

  const normalized = String(text).replace(/\r\n/g, "\n");

  for (let i = 0; i < FIELD_TAGS.length; i += 1) {
    const current = FIELD_TAGS[i];
    const startToken = `###${current.tag}`;
    const start = normalized.indexOf(startToken);
    if (start === -1) continue;

    let end = normalized.length;
    for (let j = 0; j < FIELD_TAGS.length; j += 1) {
      if (j === i) continue;
      const otherToken = `###${FIELD_TAGS[j].tag}`;
      const idx = normalized.indexOf(otherToken, start + startToken.length);
      if (idx !== -1 && idx < end) end = idx;
    }

    result[current.key] = normalized.slice(start + startToken.length, end).trim();
  }

  return result;
}

export function isPostComplete(post) {
  return Boolean(
    post.title && post.body && post.cta && post.hashtags && post.imagePrompt
  );
}
