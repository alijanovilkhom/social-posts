import { useEffect, useMemo, useRef, useState } from "react";
import { generatePosts } from "./api";
import { copyText, formatFullPost, PLATFORMS, platformById, TONES, toneById } from "./lib";
import { loadFavorites, loadHistory, newId, saveFavorites, saveHistory } from "./storage";

const emptyPost = () => ({
  id: newId(),
  title: "",
  body: "",
  cta: "",
  hashtags: "",
  imagePrompt: "",
});

export default function App() {
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("telegram");
  const [tone, setTone] = useState("engaging");
  const [count, setCount] = useState(3);
  const [posts, setPosts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState("");
  const [history, setHistory] = useState(loadHistory);
  const [favorites, setFavorites] = useState(loadFavorites);
  const [libraryTab, setLibraryTab] = useState("history");
  const [editing, setEditing] = useState(null);
  const abortRef = useRef(null);
  const toastTimer = useRef(null);
  const postsRef = useRef([]);

  useEffect(() => saveHistory(history), [history]);
  useEffect(() => saveFavorites(favorites), [favorites]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") setEditing(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canGenerate = topic.trim().length > 2 && !busy;
  const platformMeta = useMemo(() => platformById(platform), [platform]);
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);

  function notify(text, copyId = "") {
    setToast(text);
    if (copyId) {
      setCopied(copyId);
      setTimeout(() => setCopied(""), 1400);
    }
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }

  async function handleCopy(text, label = "Скопировано", copyId = "") {
    const ok = await copyText(text);
    notify(ok ? label : "Не удалось скопировать", ok ? copyId : "");
  }

  function rememberBatch(nextPosts, nextTopic = topic, nextPlatform = platform, nextTone = tone) {
    const ready = nextPosts.filter((post) => post.title || post.body);
    if (!ready.length) return;
    setHistory((prev) => [
      {
        id: newId(),
        createdAt: Date.now(),
        topic: nextTopic.trim(),
        platform: nextPlatform,
        tone: nextTone,
        posts: ready,
      },
      ...prev,
    ].slice(0, 40));
  }

  async function runGeneration({
    nextCount = count,
    startIndex = 0,
    extra = "",
    seedPosts,
  }) {
    setError("");
    setBusy(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const nextPosts = seedPosts
      ? seedPosts.map((post) => ({ ...post }))
      : Array.from({ length: nextCount }, emptyPost);
    postsRef.current = nextPosts;
    setPosts(nextPosts);

    try {
      await generatePosts({
        topic,
        platform,
        tone,
        count: nextCount,
        extra,
        startIndex,
        angleOffset: Date.now() % 9,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "variant") {
            setPosts((current) => {
              const copy = current.length
                ? current.map((item) => ({ ...item }))
                : nextPosts.map((item) => ({ ...item }));
              while (copy.length <= event.index) copy.push(emptyPost());
              copy[event.index] = {
                ...emptyPost(),
                id: copy[event.index]?.id || newId(),
                ...event.fields,
                streaming: !event.done,
              };
              postsRef.current = copy;
              return copy;
            });
          }
          if (event.type === "error") setError(event.message);
        },
      });

      const finalized = (postsRef.current.length ? postsRef.current : nextPosts).map((post) => ({
        ...post,
        streaming: false,
      }));
      postsRef.current = finalized;
      setPosts(finalized);
      rememberBatch(finalized);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message || "Не удалось сгенерировать");
    } finally {
      setBusy(false);
    }
  }

  function onGenerate(event) {
    event.preventDefault();
    if (!canGenerate) return;
    runGeneration({ nextCount: count, startIndex: 0 });
  }

  function regenerateAll() {
    if (!topic.trim()) return;
    runGeneration({
      nextCount: posts.length || count,
      startIndex: 0,
      extra: "Сделай принципиально другие формулировки, не повторяй предыдущие варианты.",
    });
  }

  function regenerateOne(index) {
    if (!topic.trim()) return;
    runGeneration({
      nextCount: 1,
      startIndex: index,
      extra: "Это перегенерация одного варианта. Смени крючок, ритм и метафоры.",
      seedPosts: posts.map((post, i) => (i === index ? { ...emptyPost(), id: post.id } : post)),
    });
  }

  function toggleFavorite(post) {
    if (!post?.id || !(post.title || post.body)) return;
    setFavorites((prev) => {
      if (prev.some((item) => item.id === post.id)) {
        notify("Удалено из избранного");
        return prev.filter((item) => item.id !== post.id);
      }
      notify("В избранном");
      return [
        {
          id: post.id,
          createdAt: Date.now(),
          topic: topic.trim(),
          platform,
          tone,
          post: { ...post, streaming: false },
        },
        ...prev,
      ];
    });
  }

  function saveEdit() {
    if (!editing) return;
    const next = posts.map((post, index) => (index === editing.index ? { ...editing.draft, streaming: false } : post));
    setPosts(next);
    postsRef.current = next;
    setFavorites((prev) =>
      prev.map((item) => (item.id === editing.draft.id ? { ...item, post: { ...editing.draft, streaming: false } } : item))
    );
    setEditing(null);
    notify("Изменения сохранены");
  }

  const libraryItems = libraryTab === "favorites"
    ? favorites.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        topic: item.topic,
        platform: item.platform,
        tone: item.tone,
        posts: [item.post],
      }))
    : history;

  return (
    <div className="app">
      <header className="toolbar glass">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1 className="logo">КАДР</h1>
            <p className="brand-sub">Студия постов</p>
          </div>
        </div>
        <p className={`status-pill ${busy ? "is-live" : ""}`} aria-live="polite">
          {busy ? "Пишу варианты…" : "Готово"}
        </p>
      </header>

      <div className="workspace">
        <aside className="sidebar glass">
          <form className="stack" onSubmit={onGenerate}>
            <div className="field">
              <label htmlFor="topic">Тема</label>
              <textarea
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Новости о котятах, кофейня, запуск курса…"
              />
            </div>

            <div className="field">
              <label>Площадка</label>
              <div className="platforms" role="radiogroup" aria-label="Площадка">
                {PLATFORMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={platform === item.id}
                    className={`platform ${platform === item.id ? "is-active" : ""}`}
                    onClick={() => setPlatform(item.id)}
                  >
                    <PlatformIcon id={item.id} />
                    <span>
                      <b>{item.label}</b>
                      <small>{item.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Тон</label>
              <div className="chips" role="radiogroup" aria-label="Тон">
                {TONES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={tone === item.id}
                    className={`chip ${tone === item.id ? "is-active" : ""}`}
                    onClick={() => setTone(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </form>

          <div className="library">
            <div className="segmented" role="tablist" aria-label="Библиотека">
              <button type="button" role="tab" aria-selected={libraryTab === "history"} className={libraryTab === "history" ? "is-active" : ""} onClick={() => setLibraryTab("history")}>История</button>
              <button type="button" role="tab" aria-selected={libraryTab === "favorites"} className={libraryTab === "favorites" ? "is-active" : ""} onClick={() => setLibraryTab("favorites")}>Избранное</button>
            </div>
            <History
              tab={libraryTab}
              items={libraryItems}
              onOpen={(item, post) => {
                setTopic(item.topic || topic);
                setPlatform(item.platform || platform);
                if (item.tone) setTone(item.tone);
                setPosts([{ ...post, streaming: false, id: post.id || newId() }]);
              }}
              onCopy={async (item, post) => {
                await handleCopy(formatFullPost(post, item.platform), "Скопировано", `lib-${item.id}`);
              }}
              onClear={() => (libraryTab === "favorites" ? setFavorites([]) : setHistory([]))}
            />
          </div>
        </aside>

        <section className="canvas">
          <div className="results-head">
            <div>
              <p className="kicker">{platformMeta.label} · {toneById(tone).label} · текст создаёт ИИ</p>
              <h2>Результаты</h2>
            </div>
            <span className="count-chip">{posts.length || 0}</span>
          </div>

          {!posts.length ? (
            <div className="empty paper">
              <div className="empty-art" aria-hidden="true" />
              <h3>Нет вариантов</h3>
              <p>Опишите тему, выберите тон и нажмите «Сгенерировать».</p>
            </div>
          ) : (
            <div className="cards">
              {posts.map((post, index) => (
                <VariantCard
                  key={post.id || `${platform}-${index}`}
                  index={index}
                  post={post}
                  platform={platform}
                  disabled={busy}
                  copied={copied}
                  favorited={favoriteIds.has(post.id)}
                  onCopy={handleCopy}
                  onRegenerate={() => regenerateOne(index)}
                  onFavorite={() => toggleFavorite(post)}
                  onEdit={() => setEditing({ index, draft: { ...post } })}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="inspector glass">
          <p className="kicker">Управление</p>
          <h2>Запуск</h2>

          <label className="field-label">Вариантов</label>
          <div className="segmented" role="radiogroup" aria-label="Количество вариантов">
            {[2, 3, 4].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={count === value}
                className={count === value ? "is-active" : ""}
                onClick={() => setCount(value)}
              >
                {value}
              </button>
            ))}
          </div>

          <button className="cta-primary" type="button" disabled={!canGenerate} onClick={() => runGeneration({ nextCount: count, startIndex: 0 })}>
            {busy ? "Пишу…" : "Сгенерировать"}
          </button>

          <button className="cta-secondary" type="button" disabled={busy || !posts.length} onClick={regenerateAll}>
            Перегенерировать всё
          </button>

          {error ? <p className="error">{error}</p> : (
            <p className="hint">ИИ пишет черновик. Можно править, сохранять в избранное и копировать.</p>
          )}
        </aside>
      </div>

      {editing ? (
        <div className="sheet-backdrop" onClick={() => setEditing(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sheet-bar">
              <button className="text-btn" type="button" onClick={() => setEditing(null)}>Отменить</button>
              <h2 id="edit-title">Редактировать</h2>
              <button className="text-btn is-primary" type="button" onClick={saveEdit}>Сохранить</button>
            </header>
            <div className="sheet-body">
              <label htmlFor="edit-title-field">Заголовок</label>
              <input
                id="edit-title-field"
                value={editing.draft.title}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })}
              />
              <label htmlFor="edit-body">Текст поста</label>
              <textarea
                id="edit-body"
                rows={8}
                value={editing.draft.body}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, body: e.target.value } })}
              />
              <label htmlFor="edit-cta">Призыв к действию</label>
              <textarea
                id="edit-cta"
                rows={3}
                value={editing.draft.cta}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, cta: e.target.value } })}
              />
              <label htmlFor="edit-tags">Хэштеги</label>
              <input
                id="edit-tags"
                value={editing.draft.hashtags}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, hashtags: e.target.value } })}
              />
              <label htmlFor="edit-image">Промпт для картинки</label>
              <textarea
                id="edit-image"
                rows={4}
                value={editing.draft.imagePrompt}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, imagePrompt: e.target.value } })}
              />
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="toast-wrap">
          <div className="toast">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}

function VariantCard({ index, post, platform, disabled, copied, favorited, onCopy, onRegenerate, onFavorite, onEdit }) {
  const full = formatFullPost(post, platform);
  const live = post.streaming ? "is-streaming" : "";
  const id = `v${index}`;
  const hasContent = Boolean(post.title || post.body || post.cta || post.hashtags || post.imagePrompt);

  if (!hasContent) return <SkeletonCard index={index} />;

  return (
    <article className="variant paper">
      <span className="frame" aria-hidden="true" />
      <header className="variant-head">
        <div className="variant-title">
          <span className="badge">Вариант {index + 1}</span>
          {post.title ? <h3 className={live}>{post.title}</h3> : <div className="skel-line skel-title" />}
        </div>
        <div className="variant-actions">
          <button className="ghost" type="button" disabled={disabled || post.streaming} onClick={onEdit}>
            Редактировать
          </button>
          <button className="ghost" type="button" disabled={disabled} onClick={onRegenerate}>
            Ещё раз
          </button>
          <IconButton active={favorited} label={favorited ? "Убрать из избранного" : "В избранное"} onClick={onFavorite}>
            <StarIcon filled={favorited} />
          </IconButton>
          <IconButton active={copied === `${id}-full`} label="Копировать пост" onClick={() => onCopy(full, "Пост скопирован", `${id}-full`)} />
        </div>
      </header>

      <SmartField label="Текст поста" value={post.body} streaming={post.streaming}>
        <p className={`content-text ${live}`}>{post.body}</p>
      </SmartField>
      <SmartField label="Призыв к действию" value={post.cta} streaming={post.streaming} action={<IconButton active={copied === `${id}-cta`} label="Копировать CTA" onClick={() => onCopy(post.cta, "CTA скопирован", `${id}-cta`)} />}>
        <p className={`content-box ${live}`}>{post.cta}</p>
      </SmartField>
      <SmartField label="Хэштеги" value={post.hashtags} streaming={post.streaming} action={<IconButton active={copied === `${id}-tags`} label="Копировать хэштеги" onClick={() => onCopy(post.hashtags, "Хэштеги скопированы", `${id}-tags`)} />}>
        <p className={`content-tags ${live}`}>{post.hashtags}</p>
      </SmartField>
      <SmartField label="Промпт для картинки" value={post.imagePrompt} streaming={post.streaming} skel="code" action={<IconButton active={copied === `${id}-img`} label="Копировать промпт" onClick={() => onCopy(post.imagePrompt, "Промпт скопирован", `${id}-img`)} />}>
        <pre className={`code-block ${live}`}>{post.imagePrompt}</pre>
      </SmartField>
    </article>
  );
}

function SkeletonCard({ index }) {
  return (
    <article className="variant paper variant-skel" aria-busy="true">
      <span className="frame" aria-hidden="true" />
      <header className="variant-head">
        <div className="variant-title">
          <span className="badge">Вариант {index + 1}</span>
          <p className="skel-status">Собираю заголовок и текст…</p>
        </div>
      </header>
      <div className="skel-line skel-title" />
      <div className="skel-line" />
      <div className="skel-line w-80" />
      <div className="skel-line w-60" />
      <div className="skel-block" />
    </article>
  );
}

function SmartField({ label, value, streaming, action, skel, children }) {
  if (value) {
    return <FieldBlock label={label} action={action}>{children}</FieldBlock>;
  }
  if (!streaming) return null;
  return (
    <FieldBlock label={label}>
      {skel === "code" ? <div className="skel-block skel-code" /> : (
        <>
          <div className="skel-line" />
          <div className="skel-line w-70" />
        </>
      )}
    </FieldBlock>
  );
}

function FieldBlock({ label, action, children }) {
  return (
    <div className="block">
      <div className="block-head">
        <span className="block-label">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function History({ tab, items, onOpen, onCopy, onClear }) {
  return (
    <div className="history">
      <div className="history-head">
        <span className="block-label">{tab === "favorites" ? "Сохранённые" : "Недавние"}</span>
        {items.length ? <button className="tertiary" type="button" onClick={onClear}>Очистить</button> : null}
      </div>
      {!items.length ? (
        <p className="hint">{tab === "favorites" ? "Здесь появятся посты со звездой." : "Готовые посты появятся здесь."}</p>
      ) : (
        <div className="history-list">
          {items.slice(0, 12).flatMap((item) =>
            item.posts.map((post, index) => (
              <div key={`${item.id}-${index}`} className="history-card">
                <button className="history-main" type="button" onClick={() => onOpen(item, post)}>
                  <b>{post.title || "Без заголовка"}</b>
                  <small>
                    {platformById(item.platform).label}
                    {item.tone ? ` · ${toneById(item.tone).label}` : ""} ·{" "}
                    {new Date(item.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </small>
                </button>
                <IconButton label="Копировать" onClick={() => onCopy(item, post)}>
                  <ClipboardIcon />
                </IconButton>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, active, children }) {
  return (
    <button className={`icon-btn ${active ? "is-active" : ""}`} type="button" aria-label={label} title={label} onClick={onClick}>
      {children || (active ? <CheckIcon /> : <ClipboardIcon />)}
    </button>
  );
}

function PlatformIcon({ id }) {
  if (id === "telegram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.5 4.3 3.8 11.1c-1.2.5-1.2 1.1-.2 1.4l4.5 1.4 10.4-6.6c.5-.3.9 0 .6.4l-8.4 7.6-.3 4.6c.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.8-1.4Z" />
      </svg>
    );
  }
  if (id === "youtube") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 8.2a3.2 3.2 0 0 0-2.3-2.3C18 5.5 12 5.5 12 5.5s-6 0-7.7.4A3.2 3.2 0 0 0 2 8.2 33 33 0 0 0 1.5 12a33 33 0 0 0 .5 3.8 3.2 3.2 0 0 0 2.3 2.3c1.7.4 7.7.4 7.7.4s6 0 7.7-.4a3.2 3.2 0 0 0 2.3-2.3 33 33 0 0 0 .5-3.8 33 33 0 0 0-.5-3.8ZM10 15.2V8.8l6 3.2-6 3.2Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Zm8.2 2H7.8A2.8 2.8 0 0 0 5 7.8v8.4A2.8 2.8 0 0 0 7.8 19h8.4A2.8 2.8 0 0 0 19 16.2V7.8A2.8 2.8 0 0 0 16.2 5ZM12 8.2A3.8 3.8 0 1 1 8.2 12 3.8 3.8 0 0 1 12 8.2Zm0 2A1.8 1.8 0 1 0 13.8 12 1.8 1.8 0 0 0 12 10.2Zm4.7-3.4a.9.9 0 1 1-.9.9.9.9 0 0 1 .9-.9Z" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4.5h6a1.5 1.5 0 0 1 1.5 1.5v.7H18A2.5 2.5 0 0 1 20.5 9v10A2.5 2.5 0 0 1 18 21.5H6A2.5 2.5 0 0 1 3.5 19V9A2.5 2.5 0 0 1 6 6.7h1.5V6A1.5 1.5 0 0 1 9 4.5Zm0 2.2V6h6v.7H9ZM6 8.7a.8.8 0 0 0-.8.8V19c0 .4.4.8.8.8h12c.4 0 .8-.4.8-.8V9.5c0-.4-.4-.8-.8-.8H6Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.8 16.4 5.9 12.5l1.4-1.4 2.5 2.5 6.9-6.9 1.4 1.4-8.3 8.3Z" />
    </svg>
  );
}

function StarIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {filled ? (
        <path d="M12 3.4 14.6 9l6.1.6-4.6 4.1 1.4 6-5.5-3.2L6.5 19.7l1.4-6L3.3 9.6 9.4 9 12 3.4Z" />
      ) : (
        <path d="M12 5.2 13.7 9l4.1.4-3.1 2.8.9 4-3.6-2.1-3.6 2.1.9-4L6.2 9.4 10.3 9 12 5.2Zm0-2.6L8.8 8.6 2.6 9.3l4.7 4.2-1.4 6.2L12 16.5l6.1 3.2-1.4-6.2 4.7-4.2-6.2-.7L12 2.6Z" />
      )}
    </svg>
  );
}
