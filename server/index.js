import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { buildPrompt } from "./prompt.js";
import { parseLabeledPost } from "./parsePost.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(rootDir, ".env") });

const app = express();
const PORT = Number(process.env.PORT) || 3001;

const MODEL_FALLBACKS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
];

function modelCandidates() {
  const preferred = process.env.GEMINI_MODEL?.trim();
  return [...new Set([preferred, ...MODEL_FALLBACKS].filter(Boolean))];
}

let resolvedModel = null;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Некорректный JSON в запросе." });
    return;
  }
  next(err);
});

function getApiKey() {
  return (process.env.GEMINI_API_KEY || "").trim();
}

function publicErrorMessage(error) {
  const raw = error?.message || String(error || "Неизвестная ошибка");
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    /* plain text */
  }
  return raw;
}

function isRetryableModelError(error) {
  if (error?.code === "MODEL_TIMEOUT") return true;
  const message = publicErrorMessage(error);
  return /not found|NOT_FOUND|no longer available|invalid model|404|503|UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED|too long/i.test(
    message
  );
}

function nextWithTimeout(iterator, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error("Модель слишком долго не отвечает, пробую другую.");
      err.code = "MODEL_TIMEOUT";
      reject(err);
    }, ms);
    iterator
      .next()
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

const writeLocks = new WeakMap();

function sseWrite(res, payload) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  const previous = writeLocks.get(res) || Promise.resolve();
  const next = previous.then(() => {
    if (!res.writableEnded) res.write(message);
  });
  writeLocks.set(res, next.catch(() => {}));
}

async function streamOneVariant({ ai, model, prompt, index, res, signal }) {
  let buffer = "";
  let lastSent = "";

  const stream = await ai.models.generateContentStream({
    model,
    contents: prompt,
    config: {
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    },
  });

  const iterator = stream[Symbol.asyncIterator]();
  let waitingFirstChunk = true;

  try {
    while (true) {
      const { value: chunk, done } = waitingFirstChunk
        ? await nextWithTimeout(iterator, 25000)
        : await iterator.next();
      waitingFirstChunk = false;
      if (done) break;
      if (signal?.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      let piece = "";
      try {
        piece = chunk.text ?? "";
      } catch {
        piece = "";
      }
      if (!piece) continue;
      buffer += piece;
      const fields = parseLabeledPost(buffer);
      const serialized = JSON.stringify(fields);
      if (serialized !== lastSent) {
        lastSent = serialized;
        sseWrite(res, { type: "variant", index, fields, done: false });
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    if (!buffer) throw error;
    console.error("Gemini stream interrupted:", publicErrorMessage(error));
  }

  const fields = parseLabeledPost(buffer);
  sseWrite(res, { type: "variant", index, fields, done: true });
  return fields;
}

async function generateWithFallback(ai, params) {
  const tried = new Set();
  const models = [
    resolvedModel,
    ...modelCandidates(),
  ].filter((model) => {
    if (!model || tried.has(model)) return false;
    tried.add(model);
    return true;
  });

  let lastError;
  for (const model of models) {
    try {
      const result = await streamOneVariant({ ...params, ai, model });
      resolvedModel = model;
      return result;
    } catch (error) {
      lastError = error;
      console.error("Gemini model fail:", model, error?.name, publicErrorMessage(error));
      if (error?.name === "AbortError") throw error;
      if (!isRetryableModelError(error)) throw error;
      sseWrite(params.res, {
        type: "info",
        message: `Модель ${model} недоступна, пробую другую.`,
      });
    }
  }

  throw lastError || new Error("Не удалось подобрать доступную модель Gemini.");
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasServerKey: Boolean(getApiKey()),
    model: resolvedModel || process.env.GEMINI_MODEL || MODEL_FALLBACKS[0],
  });
});

app.post("/api/generate", async (req, res) => {
  const topic = String(req.body?.topic || "").trim();
  const platform = String(req.body?.platform || "telegram").toLowerCase();
  const count = Math.min(4, Math.max(1, Number(req.body?.count) || 3));
  const extra = String(req.body?.extra || "").trim();
  const tone = String(req.body?.tone || "engaging").toLowerCase();
  const startIndex = Math.max(0, Number(req.body?.startIndex) || 0);
  const angleOffset = Math.max(0, Number(req.body?.angleOffset) || 0);

  if (!topic) {
    res.status(400).json({ error: "Введите тему или описание." });
    return;
  }

  if (!["telegram", "instagram", "youtube"].includes(platform)) {
    res.status(400).json({ error: "Неизвестная соцсеть." });
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    res.status(401).json({
      error: "Нет ключа Gemini. Добавьте GEMINI_API_KEY в файл .env и перезапустите сервер.",
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const ac = new AbortController();
  res.on("close", () => ac.abort());

  const ai = new GoogleGenAI({ apiKey });
  sseWrite(res, { type: "start", count, startIndex, platform, topic });

  try {
    const jobs = Array.from({ length: count }, (_, offset) => {
      const index = startIndex + offset;
      const prompt = buildPrompt({
        topic,
        platform,
        angleIndex: angleOffset + offset,
        extra,
        tone,
      });
      return generateWithFallback(ai, {
        prompt,
        index,
        res,
        signal: ac.signal,
      });
    });

    await Promise.all(jobs);
    sseWrite(res, { type: "done" });
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error("Gemini generate error:", publicErrorMessage(error));
      sseWrite(res, {
        type: "error",
        message: publicErrorMessage(error) || "Не удалось сгенерировать пост.",
      });
    }
  } finally {
    await writeLocks.get(res);
    if (!res.writableEnded) res.end();
  }
});

const distDir = path.join(rootDir, "dist");
app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) {
    next();
    return;
  }
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  const hasKey = Boolean(getApiKey());
  console.log(`КАДР API: http://localhost:${PORT}`);
  console.log(hasKey ? "Gemini-ключ загружен из .env" : "ВНИМАНИЕ: в .env нет GEMINI_API_KEY");
});
