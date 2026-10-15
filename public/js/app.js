// ================= Helpers =================

const app = document.getElementById('app');

/** Cria elementos sem usar innerHTML (evita XSS com o conteúdo dos posts). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function toast(message, type = 'info') {
  const el = h('div', { class: `toast toast--${type}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3500);
}

// SQLite grava em UTC no formato "YYYY-MM-DD HH:MM:SS"
const parseDate = (s) => new Date(s.replace(' ', 'T') + 'Z');
const fmtLong = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function relative(date) {
  const diff = (Date.now() - date) / 1000;
  if (diff < 60) return 'agora mesmo';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) {
    const d = Math.floor(diff / 86400);
    return d === 1 ? 'ontem' : `há ${d} dias`;
  }
  return fmtShort.format(date);
}

function readingTime(text) {
  const words = text.trim().split(/\s+/).length;
  return `${Math.max(1, Math.round(words / 200))} min de leitura`;
}

/** Parágrafos separados por linha em branco; quebras simples viram <br>. */
function renderContent(text) {
  return text.split(/\n\s*\n/).map((para) => {
    const lines = para.split('\n');
    return h('p', {}, lines.flatMap((line, i) => (i ? [h('br'), line] : [line])));
  });
}

const MOODS = ['😊', '😄', '🥰', '😌', '🤔', '😴', '😢', '😤', '🤒', '🎉'];

// ================= Router =================

const routes = [
  [/^#?\/?$/, renderHome],
  [/^#\/post\/(\d+)$/, renderPost],
  [/^#\/novo$/, () => renderForm()],
  [/^#\/editar\/(\d+)$/, (id) => renderForm(id)],
];

let currentCleanup = null;

async function router() {
  currentCleanup?.();
  currentCleanup = null;
  const hash = location.hash || '#/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query);
  for (const [pattern, handler] of routes) {
    const match = path.match(pattern);
    if (match) {
      window.scrollTo({ top: 0 });
      try {
        await handler(...match.slice(1), params);
      } catch (err) {
        renderError(err.message);
      }
      return;
    }
  }
  renderError('Página não encontrada.');
}

window.addEventListener('hashchange', router);

function renderError(message) {
  app.replaceChildren(
    h('div', { class: 'empty' },
      h('div', { class: 'emoji' }, '😕'),
      h('h2', {}, 'Ops!'),
      h('p', {}, message),
      h('a', { href: '#/', class: 'btn' }, 'Voltar ao início'),
    ),
  );
}

// ================= Home =================

async function renderHome(params) {
  const page = Number(params?.get('page')) || 1;
  const search = params?.get('q') || '';

  const grid = h('div', { class: 'grid' },
    Array.from({ length: 3 }, () => h('div', { class: 'skeleton skeleton--card' })));

  const input = h('input', {
    type: 'search', placeholder: 'Buscar nos seus posts…', value: search, 'aria-label': 'Buscar',
  });
  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = input.value.trim();
      history.replaceState(null, '', q ? `#/?q=${encodeURIComponent(q)}` : '#/');
      loadList(1, q);
    }, 300);
  });

  const pagination = h('div', { class: 'pagination' });
  const heading = h('p', {}, '');

  app.replaceChildren(
    h('section', { class: 'hero' },
      h('h1', {}, greeting()),
      heading,
    ),
    h('form', { class: 'search', role: 'search', onsubmit: (e) => e.preventDefault() }, input),
    grid,
    pagination,
  );

  async function loadList(p, q) {
    const qs = new URLSearchParams({ page: p, limit: 9 });
    if (q) qs.set('q', q);
    const data = await api(`/posts?${qs}`);

    heading.textContent = q
      ? `${data.total} resultado${data.total === 1 ? '' : 's'} para “${q}”`
      : `${data.total} registro${data.total === 1 ? '' : 's'} no seu diário`;

    if (!data.posts.length) {
      grid.replaceChildren(
        h('div', { class: 'empty', style: 'grid-column: 1 / -1' },
          h('div', { class: 'emoji' }, q ? '🔍' : '🌱'),
          h('h2', {}, q ? 'Nada encontrado' : 'Seu diário está vazio'),
          h('p', {}, q ? 'Tente outras palavras.' : 'Que tal escrever sobre como foi o seu dia?'),
          !q && h('a', { href: '#/novo', class: 'btn btn--primary' }, 'Escrever primeiro post'),
        ),
      );
      pagination.replaceChildren();
      return;
    }

    grid.replaceChildren(...data.posts.map((post, i) => postCard(post, i)));

    const go = (n) => {
      const qp = new URLSearchParams();
      if (q) qp.set('q', q);
      if (n > 1) qp.set('page', n);
      location.hash = `#/${qp.size ? `?${qp}` : ''}`;
    };
    pagination.replaceChildren(
      ...(data.pages > 1 ? [
        h('button', { class: 'btn', disabled: data.page <= 1, onclick: () => go(data.page - 1) }, '← Anteriores'),
        h('span', {}, `${data.page} de ${data.pages}`),
        h('button', { class: 'btn', disabled: data.page >= data.pages, onclick: () => go(data.page + 1) }, 'Próximos →'),
      ] : []),
    );
  }

  await loadList(page, search);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia ☀️';
  if (hour < 18) return 'Boa tarde 🌤️';
  return 'Boa noite 🌙';
}

function postCard(post, index) {
  const date = parseDate(post.created_at);
  const cover = post.images[0];
  return h('a', { href: `#/post/${post.id}`, class: 'card', style: `animation-delay: ${index * 50}ms` },
    cover
      ? h('img', { class: 'card__cover', src: cover.url, alt: '', loading: 'lazy' })
      : h('div', { class: 'card__cover card__cover--empty' }, post.mood || '📖'),
    h('div', { class: 'card__body' },
      h('div', { class: 'card__meta' },
        h('time', { datetime: date.toISOString(), title: fmtLong.format(date) }, relative(date)),
        post.mood && cover && h('span', { class: 'badge' }, post.mood),
        post.images.length > 1 && h('span', { class: 'badge' }, `📷 ${post.images.length}`),
      ),
      h('h2', { class: 'card__title' }, post.title),
      h('p', { class: 'card__excerpt' }, post.content.slice(0, 240)),
    ),
  );
}

// ================= Post =================

async function renderPost(id) {
  app.replaceChildren(h('div', { class: 'post' }, h('div', { class: 'skeleton', style: 'height: 400px' })));
  const post = await api(`/posts/${id}`);
  const created = parseDate(post.created_at);
  const updated = parseDate(post.updated_at);
  const edited = updated - created > 60_000;

  const gallery = post.images.length
    ? h('div', { class: `gallery ${post.images.length === 1 ? 'gallery--single' : ''}` },
        post.images.map((img, i) =>
          h('button', { type: 'button', 'aria-label': `Ampliar imagem ${i + 1}`, onclick: () => openLightbox(post.images, i) },
            h('img', { src: img.url, alt: img.original || '', loading: 'lazy' }))))
    : null;

  document.title = `${post.title} · Meu Diário`;
  currentCleanup = () => { document.title = 'Meu Diário'; };

  app.replaceChildren(
    h('article', { class: 'post' },
      h('a', { href: '#/', class: 'post__back' }, '← Todos os posts'),
      h('h1', { class: 'post__title' }, post.title),
      h('div', { class: 'post__meta' },
        post.mood && h('span', { class: 'badge', style: 'font-size: 1rem' }, post.mood),
        h('time', { datetime: created.toISOString() }, `${fmtLong.format(created)} às ${fmtTime.format(created)}`),
        h('span', {}, `· ${readingTime(post.content)}`),
        edited && h('span', { title: `Editado em ${fmtLong.format(updated)} às ${fmtTime.format(updated)}` }, '· editado'),
      ),
      gallery,
      h('div', { class: 'post__content' }, renderContent(post.content)),
      h('div', { class: 'post__actions' },
        h('a', { href: `#/editar/${post.id}`, class: 'btn' }, '✏️ Editar'),
        h('button', { class: 'btn btn--danger', type: 'button', onclick: () => deletePost(post) }, '🗑️ Excluir'),
      ),
    ),
  );
}

async function deletePost(post) {
  if (!confirm(`Excluir “${post.title}”? Isso não pode ser desfeito.`)) return;
  try {
    await api(`/posts/${post.id}`, { method: 'DELETE' });
    toast('Post excluído.');
    location.hash = '#/';
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ================= Form (criar / editar) =================

async function renderForm(id) {
  const editing = Boolean(id);
  const post = editing ? await api(`/posts/${id}`) : { title: '', content: '', mood: '', images: [] };

  const newFiles = [];           // { file, url }
  const removeIds = new Set();   // ids das imagens existentes marcadas para remoção
  let mood = post.mood || '';
  let dirty = false;

  const title = h('input', { id: 'title', name: 'title', required: true, maxlength: 200, value: post.title, placeholder: 'Como foi o seu dia?' });
  const content = h('textarea', { id: 'content', name: 'content', required: true, placeholder: 'Escreva livremente…\n\nDeixe uma linha em branco para começar um novo parágrafo.' });
  content.value = post.content;
  const counter = h('span', { class: 'hint' });
  const updateCounter = () => {
    const words = content.value.trim() ? content.value.trim().split(/\s+/).length : 0;
    counter.textContent = `${words} palavra${words === 1 ? '' : 's'}`;
  };
  updateCounter();
  content.addEventListener('input', updateCounter);

  const moods = h('div', { class: 'moods', role: 'group', 'aria-label': 'Humor do dia' },
    MOODS.map((m) => h('button', {
      type: 'button', 'aria-pressed': String(m === mood),
      onclick: (e) => {
        mood = mood === m ? '' : m;
        dirty = true;
        moods.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === mood)));
        e.currentTarget.blur();
      },
    }, m)),
  );

  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const thumbs = h('div', { class: 'thumbs' });
  const dropzone = h('div', {
    class: 'dropzone', tabindex: 0, role: 'button',
    onclick: () => fileInput.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
  },
    h('div', { style: 'font-size: 2rem' }, '🖼️'),
    h('div', {}, h('strong', {}, 'Clique para escolher'), ' ou arraste imagens aqui'),
    h('div', { class: 'hint' }, 'JPG, PNG, GIF, WEBP ou AVIF · até 10 MB cada'),
  );

  function addFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        toast(`“${file.name}” não é uma imagem.`, 'error');
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast(`“${file.name}” passa de 10 MB.`, 'error');
        continue;
      }
      newFiles.push({ file, url: URL.createObjectURL(file) });
    }
    dirty = true;
    drawThumbs();
  }

  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('is-over')));
  dropzone.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });

  // Colar imagem com Ctrl+V
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); toast('Imagem colada!'); }
  };
  document.addEventListener('paste', onPaste);

  function drawThumbs() {
    thumbs.replaceChildren(
      ...post.images.map((img) => {
        const removed = removeIds.has(img.id);
        return h('div', { class: `thumb ${removed ? 'thumb--removed' : ''}` },
          h('img', { src: img.url, alt: '' }),
          h('button', {
            type: 'button', title: removed ? 'Manter imagem' : 'Remover imagem',
            onclick: () => { removed ? removeIds.delete(img.id) : removeIds.add(img.id); dirty = true; drawThumbs(); },
          }, removed ? '↺' : '✕'),
        );
      }),
      ...newFiles.map((nf, i) =>
        h('div', { class: 'thumb' },
          h('img', { src: nf.url, alt: nf.file.name }),
          h('span', { class: 'thumb__tag' }, 'nova'),
          h('button', {
            type: 'button', title: 'Remover',
            onclick: () => { URL.revokeObjectURL(nf.url); newFiles.splice(i, 1); drawThumbs(); },
          }, '✕'),
        )),
    );
  }
  drawThumbs();

  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, editing ? 'Salvar alterações' : 'Publicar');

  const form = h('form', { class: 'form', novalidate: true },
    h('h1', {}, editing ? 'Editar post' : 'Novo post'),
    h('div', { class: 'field field--title' }, h('label', { for: 'title' }, 'Título'), title),
    h('div', { class: 'field' }, h('label', {}, 'Humor do dia ', h('span', { class: 'hint' }, '(opcional)')), moods),
    h('div', { class: 'field' }, h('label', { for: 'content' }, 'Texto'), content, counter),
    h('div', { class: 'field' }, h('label', {}, 'Imagens'), dropzone, fileInput, thumbs,
      h('span', { class: 'hint' }, 'Dica: você também pode colar uma imagem com Ctrl+V. A primeira vira a capa.')),
    h('div', { class: 'form__actions' },
      h('a', { href: editing ? `#/post/${id}` : '#/', class: 'btn' }, 'Cancelar'),
      submit,
    ),
  );

  form.addEventListener('input', () => { dirty = true; });

  // Salvar com Ctrl+Enter
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!title.value.trim()) { toast('Dê um título ao post.', 'error'); title.focus(); return; }
    if (!content.value.trim()) { toast('Escreva alguma coisa no texto.', 'error'); content.focus(); return; }

    const body = new FormData();
    body.set('title', title.value);
    body.set('content', content.value);
    body.set('mood', mood);
    newFiles.forEach((nf) => body.append('images', nf.file));
    if (editing) body.set('removeImages', JSON.stringify([...removeIds]));

    submit.disabled = true;
    submit.textContent = 'Salvando…';
    try {
      const saved = await api(editing ? `/posts/${id}` : '/posts', { method: editing ? 'PUT' : 'POST', body });
      dirty = false;
      toast(editing ? 'Post atualizado ✨' : 'Post publicado 🎉');
      location.hash = `#/post/${saved.id}`;
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
      submit.textContent = editing ? 'Salvar alterações' : 'Publicar';
    }
  });

  const onBeforeUnload = (e) => { if (dirty) e.preventDefault(); };
  window.addEventListener('beforeunload', onBeforeUnload);

  currentCleanup = () => {
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('beforeunload', onBeforeUnload);
    newFiles.forEach((nf) => URL.revokeObjectURL(nf.url));
  };

  app.replaceChildren(form);
  if (!editing) title.focus();
}

// ================= Lightbox =================

const lightbox = document.getElementById('lightbox');
const lbImg = lightbox.querySelector('img');
const lbCount = lightbox.querySelector('.lightbox__count');
let lbImages = [];
let lbIndex = 0;

function openLightbox(images, index) {
  lbImages = images;
  lbIndex = index;
  showLightbox();
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
}

function showLightbox() {
  const img = lbImages[lbIndex];
  lbImg.src = img.url;
  lbImg.alt = img.original || '';
  lbCount.textContent = lbImages.length > 1 ? `${lbIndex + 1} / ${lbImages.length}` : '';
  lightbox.querySelectorAll('.lightbox__nav').forEach((b) => { b.hidden = lbImages.length < 2; });
}

function closeLightbox() {
  lightbox.hidden = true;
  document.body.style.overflow = '';
}

function stepLightbox(delta) {
  lbIndex = (lbIndex + delta + lbImages.length) % lbImages.length;
  showLightbox();
}

lightbox.querySelector('.lightbox__close').addEventListener('click', closeLightbox);
lightbox.querySelector('.lightbox__nav--prev').addEventListener('click', () => stepLightbox(-1));
lightbox.querySelector('.lightbox__nav--next').addEventListener('click', () => stepLightbox(1));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (lightbox.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
});

// Swipe no celular
let touchX = null;
lightbox.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
lightbox.addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50 && lbImages.length > 1) stepLightbox(dx < 0 ? 1 : -1);
  touchX = null;
});

// ================= Tema =================

document.getElementById('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
});

router();
