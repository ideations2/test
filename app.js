const state = {
  repo: 'ideations2/test',
  ref: 'main',
  files: [],
  selectedFile: '',
  token: localStorage.getItem('commit-preview-token') || '',
};

const repoInput = document.getElementById('repo-input');
const refInput = document.getElementById('ref-input');
const statusEl = document.getElementById('status');
const commitMetaEl = document.getElementById('commit-meta');
const treeEl = document.getElementById('tree');
const previewFrame = document.getElementById('preview-frame');
const codeViewer = document.getElementById('code-viewer');
const codeContent = document.getElementById('code-content');
const activeFileLabel = document.getElementById('active-file-label');
const tokenInput = document.getElementById('token-input');
const authPill = document.getElementById('auth-pill');
const userLabel = document.getElementById('user-label');
const githubOAuthBtn = document.getElementById('github-oauth');
const logoutBtn = document.getElementById('logout-btn');
const toggleViewBtn = document.getElementById('toggle-view');

if (state.token) {
  tokenInput.value = state.token;
  authPill.textContent = 'Token mode';
  authPill.classList.add('authenticated');
  userLabel.textContent = 'Using saved PAT';
}

function setStatus(message, kind = 'neutral') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function makeHeaders(extra = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    ...extra,
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  return headers;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: makeHeaders(options.headers || {}),
  });

  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message = payload?.message || 'GitHub request failed.';
    throw new Error(message);
  }

  return payload;
}

function humanizeHash(hash) {
  return hash ? hash.slice(0, 7) : 'unknown';
}

function renderMeta(commit) {
  if (!commit) {
    commitMetaEl.innerHTML = '<div class="empty-state">No commit loaded.</div>';
    return;
  }

  const rows = [
    ['Message', commit.message || '—'],
    ['Author', commit.author || '—'],
    ['Commit', humanizeHash(commit.sha)],
    ['Date', commit.date ? new Date(commit.date).toLocaleString() : '—'],
  ];

  commitMetaEl.innerHTML = rows
    .map(
      ([label, value]) => `
        <div class="row">
          <div class="label">${label}</div>
          <div class="value">${value}</div>
        </div>
      `
    )
    .join('');
}

function findPreferredEntry(files) {
  const preferredNames = [
    'index.html',
    'src/index.html',
    'public/index.html',
    'app/index.html',
    'src/main.js',
    'src/main.ts',
    'main.js',
    'app.js',
    'index.js',
  ];

  for (const candidate of preferredNames) {
    const match = files.find((file) => file.path === candidate || file.path.endsWith(`/${candidate}`));
    if (match) return match;
  }

  return files.find((file) => file.path.toLowerCase().endsWith('.html')) || files[0] || null;
}

function renderTree(files) {
  treeEl.innerHTML = '';

  if (!files.length) {
    treeEl.innerHTML = '<div class=\"empty-state\">No files found in this commit.</div>';
    return;
  }

  for (const file of files) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'tree-item';

    if (file.path === state.selectedFile) {
      item.classList.add('active');
    }

    const icon = getFileIcon(file.path);
    item.innerHTML = `<span class=\"icon\">${icon}</span><span>${file.path.split('/').pop()}</span>`;

    item.addEventListener('click', async () => {
      state.selectedFile = file.path;
      renderTree(files);
      await openFile(file.path);
    });

    treeEl.appendChild(item);
  }
}

function getFileIcon(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html')) return '📄';
  if (lower.endsWith('.css')) return '🎨';
  if (lower.endsWith('.js') || lower.endsWith('.ts')) return '🧩';
  if (lower.endsWith('.json')) return '🧾';
  if (lower.endsWith('.md')) return '📝';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.svg')) return '🖼️';
  return '📁';
}

async function openFile(filePath) {
  const endpoint = `https://api.github.com/repos/${state.repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(state.ref)}`;
  const response = await apiFetch(endpoint);

  const content = response.content ? atob(response.content.replace(/\n/g, '')) : '';

  activeFileLabel.textContent = filePath;
  codeContent.textContent = content;

  if (filePath.toLowerCase().endsWith('.html')) {
    renderHtmlPreview(content, filePath);
  } else {
    previewFrame.srcdoc = `
      <!doctype html>
      <html>
        <body style="margin:0; font-family:sans-serif; background:#0f172a; color:#e2e8f0; display:grid; place-items:center; min-height:100vh;">
          <div style="padding:24px; max-width:700px; text-align:center;">
            <h2 style="margin:0 0 12px;">File preview not available</h2>
            <p style="margin:0; color:#94a3b8;">This file is source code only. Select an HTML entry file to render a live page.</p>
          </div>
        </body>
      </html>
    `;
  }
}

function renderHtmlPreview(rawHtml, filePath) {
  const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/') + 1) : '';

  const rewritten = rawHtml.replace(/(src|href)=(['"])([^'"]+)(\2)/gi, (match, attr, quote, val) => {
    if (!val || /^(?:[a-z]+:|\/\/|#|data:)/i.test(val)) {
      return match;
    }

    const assetPath = val.startsWith('/') ? val.slice(1) : `${dir}${val}`;
    const proxied = `https://raw.githubusercontent.com/${state.repo}/${state.ref}/${assetPath}`;
    return `${attr}=${quote}${proxied}${quote}`;
  });

  previewFrame.srcdoc = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head><body>${rewritten}</body></html>`;
}

async function loadCommit(repo, ref) {
  if (!repo || !ref) {
    throw new Error('Repository and branch/commit are required.');
  }

  const commitUrl = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`;
  const commitData = await apiFetch(commitUrl);

  const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${commitData.commit.tree.sha}?recursive=1`;
  const treeData = await apiFetch(treeUrl);

  state.repo = repo;
  state.ref = ref;
  state.files = (treeData.tree || []).filter((node) => node.type === 'blob');
  state.selectedFile = '';

  renderMeta({
    sha: commitData.sha,
    message: commitData.commit.message,
    author: commitData.commit.author?.login || commitData.commit.author?.name || 'unknown',
    date: commitData.commit.author?.date || null,
  });

  renderTree(state.files);

  const preferred = findPreferredEntry(state.files);

  if (preferred) {
    state.selectedFile = preferred.path;
    renderTree(state.files);
    await openFile(preferred.path);
    setStatus(`Loaded ${state.repo}@${state.ref}.`, 'success');
  } else {
    previewFrame.srcdoc = `
      <!doctype html>
      <html>
        <body style="margin:0; display:grid; place-items:center; min-height:100vh; background:#0f172a; color:#e2e8f0; font-family:sans-serif;">
          <div style="text-align:center; max-width:600px; padding:24px;">
            <h2>No browser entry file found</h2>
            <p style="color:#94a3b8;">This commit does not expose a UI entry file like index.html or a main JavaScript app.</p>
          </div>
        </body>
      </html>
    `;
    codeContent.textContent = 'No browser entry file was found in this commit. Use the file tree below to inspect source files manually.';
    activeFileLabel.textContent = 'No file selected';
    setStatus(`Loaded ${state.repo}@${state.ref}, but no web entry file was found.`, 'neutral');
  }
}

function saveToken() {
  const token = tokenInput.value.trim();
  state.token = token;

  if (!token) {
    localStorage.removeItem('commit-preview-token');
    authPill.textContent = 'Public mode';
    authPill.classList.remove('authenticated');
    userLabel.textContent = 'Public GitHub Pages mode';
    setStatus('Token cleared. Public repo access remains active.', 'neutral');
    return;
  }

  localStorage.setItem('commit-preview-token', token);
  authPill.textContent = 'Token mode';
  authPill.classList.add('authenticated');
  userLabel.textContent = 'Using saved PAT';
  setStatus('Token saved locally for GitHub API access.', 'success');
}

function logout() {
  state.token = '';
  localStorage.removeItem('commit-preview-token');
  tokenInput.value = '';
  authPill.textContent = 'Public mode';
  authPill.classList.remove('authenticated');
  userLabel.textContent = 'Public GitHub Pages mode';
  setStatus('Logged out of token mode. Public repos remain available.', 'neutral');
}

githubOAuthBtn.addEventListener('click', () => {
  setStatus('GitHub OAuth is not supported on GitHub Pages. Use a PAT in the field above for private repos or use a backend host.', 'neutral');
});

logoutBtn.addEventListener('click', logout);
document.getElementById('save-token-btn').addEventListener('click', saveToken);

document.getElementById('commit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const repo = repoInput.value.trim();
  const ref = refInput.value.trim();

  try {
    setStatus(`Loading ${repo}@${ref}...`, 'neutral');
    await loadCommit(repo, ref);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Unable to load the commit.', 'error');
  }
});

toggleViewBtn.addEventListener('click', () => {
  codeViewer.classList.toggle('visible');
  toggleViewBtn.textContent = codeViewer.classList.contains('visible') ? 'Hide code' : 'Show code';
});

(async () => {
  try {
    await loadCommit('ideations2/test', 'main');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Unable to load the default repo.', 'error');
  }
})();
