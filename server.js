import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'commit-preview-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

function getConfiguredToken(req) {
  return req.session.githubToken || process.env.GITHUB_TOKEN || null;
}

function getAuthHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function githubApi(url, token, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      ...getAuthHeaders(token),
      ...extraHeaders,
    },
  });

  const text = await response.text();
  let data = text;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(data?.message || 'GitHub API request failed');
  }

  return data;
}

function buildCallbackUrl(req) {
  const configured = process.env.GITHUB_REDIRECT_URI;
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}/api/auth/callback`;
}

function guessMime(pathname) {
  const extension = pathname.split('.').pop()?.toLowerCase();

  const mapping = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    svg: 'image/svg+xml; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    ico: 'image/x-icon',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
  };

  return mapping[extension] || 'text/plain; charset=utf-8';
}

app.get('/api/session', (req, res) => {
  const token = getConfiguredToken(req);
  res.json({
    authenticated: !!token,
    user: req.session.user || null,
    oauthConfigured: !!GITHUB_CLIENT_ID,
  });
});

app.post('/api/session/token', (req, res) => {
  const token = (req.body.token || '').trim();

  if (!token) {
    return res.status(400).json({ error: 'A GitHub token is required.' });
  }

  req.session.githubToken = token;
  req.session.user = req.body.username || 'token-user';
  return res.json({ ok: true, authenticated: true });
});

app.post('/api/session/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/auth/github', (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    return res.status(400).json({ error: 'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your .env file.' });
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: buildCallbackUrl(req),
    scope: 'repo read:user user:email',
    state,
  });

  return res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Missing OAuth code.');
  }

  if (req.session.oauthState && state && req.session.oauthState !== state) {
    return res.status(400).send('Invalid OAuth state.');
  }

  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.status(500).send('OAuth is not configured on this server.');
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: buildCallbackUrl(req),
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || 'GitHub OAuth exchange failed.');
    }

    const userData = await githubApi('https://api.github.com/user', tokenData.access_token);
    req.session.githubToken = tokenData.access_token;
    req.session.user = userData.login;

    return res.redirect('/?auth=success');
  } catch (error) {
    console.error('OAuth callback failed:', error);
    return res.status(500).send(`GitHub OAuth failed: ${error.message}`);
  }
});

app.get('/api/commit', async (req, res) => {
  const repo = String(req.query.repo || '').trim();
  const ref = String(req.query.ref || '').trim();

  if (!repo || !ref) {
    return res.status(400).json({ error: 'repo and ref are required.' });
  }

  try {
    const token = getConfiguredToken(req);
    const commitUrl = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`;
    const commit = await githubApi(commitUrl, token);

    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`;
    const tree = await githubApi(treeUrl, token);

    const files = (tree.tree || [])
      .filter((node) => node.type === 'blob')
      .map((node) => ({
        path: node.path,
        size: node.size,
        sha: node.sha,
      }));

    return res.json({
      repo,
      ref,
      commit: {
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author?.name || commit.author?.login || 'unknown',
        date: commit.commit.author?.date || null,
      },
      files,
    });
  } catch (error) {
    console.error('Commit lookup failed:', error);
    return res.status(500).json({ error: error.message || 'Unable to load the commit.' });
  }
});

app.get('/api/file', async (req, res) => {
  const repo = String(req.query.repo || '').trim();
  const ref = String(req.query.ref || '').trim();
  const filePath = String(req.query.path || '').trim();

  if (!repo || !ref || !filePath) {
    return res.status(400).json({ error: 'repo, ref, and path are required.' });
  }

  try {
    const token = getConfiguredToken(req);
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`;
    const contents = await githubApi(url, token);

    if (contents.type !== 'file') {
      return res.status(400).json({ error: 'The selected path is not a file.' });
    }

    const body = contents.content ? contents.content.replace(/\n/g, '') : '';
    const decoded = contents.encoding === 'base64' ? Buffer.from(body, 'base64').toString('utf8') : body;

    return res.json({
      path: filePath,
      content: decoded,
      sha: contents.sha,
      encoding: contents.encoding,
    });
  } catch (error) {
    console.error('File lookup failed:', error);
    return res.status(500).json({ error: error.message || 'Unable to read the file.' });
  }
});

app.get('/api/raw', async (req, res) => {
  const repo = String(req.query.repo || '').trim();
  const ref = String(req.query.ref || '').trim();
  const filePath = String(req.query.path || '').trim();

  if (!repo || !ref || !filePath) {
    return res.status(400).send('repo, ref, and path are required.');
  }

  try {
    const token = getConfiguredToken(req);
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`;
    const contents = await githubApi(url, token);

    if (contents.type !== 'file') {
      return res.status(400).send('Not a file.');
    }

    const body = contents.content ? contents.content.replace(/\n/g, '') : '';
    const buffer = contents.encoding === 'base64' ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
    const mime = guessMime(filePath);

    res.setHeader('Content-Type', mime);
    return res.send(buffer);
  } catch (error) {
    console.error('RAW proxy failed:', error);
    return res.status(500).send(error.message || 'Unable to proxy file content.');
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Commit Live Preview is running on http://localhost:${PORT}`);
});
