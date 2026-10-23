# Commit Live Preview

A production-ready single-turn app for viewing any commit in a repository's history as a live, fully functioning app/page preview.

## Features

- GitHub OAuth login for authenticated private repo access
- Personal access token fallback for private repos
- Repo + ref selection for any public or private GitHub repo
- Recursive file tree browser for a historical commit
- Live HTML/JS/CSS preview in an iframe
- Code viewer for selected file contents
- Responsive dark-mode UI
- Works with public repos without auth, private repos with OAuth or PAT

## Quick start

1. Install dependencies:
   npm install

2. Create a `.env` file from `.env.example` and fill in the values:
   cp .env.example .env

3. Start the app:
   npm start

4. Open:
   http://localhost:3000

## GitHub OAuth setup

If you want real GitHub OAuth for authenticated users:

1. Create a GitHub OAuth App at https://github.com/settings/developers
2. Set the callback URL to:
   http://localhost:3000/api/auth/callback
3. Copy the Client ID and Client Secret to `.env`

The app requests:
- `repo`
- `read:user`
- `user:email`

## Token mode (private repos without OAuth)

For private repos or for quick setup, paste a GitHub personal access token (PAT) in the UI.

Recommended PAT scopes:
- `repo` for private repos
- `read:user` if you want user metadata

## Notes

- For private repos, the app uses the active session token or the configured `GITHUB_TOKEN` fallback.
- Public repos work without any token.
- This is a secure app pattern because token exchange happens server-side.

## Example use

- Repository: `ideations2/test`
- Ref: `main`
- The app loads the commit tree, picks an app entry file, and renders it live in the iframe.
