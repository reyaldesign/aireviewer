# Deploying to a DreamHost VPS

This app needs a persistent Python process and a writable local disk (for
the SQLite database and uploaded images), so it needs DreamHost's
**Self-Managed VPS** plan — shared hosting can't run it (no persistent
processes, no root, CGI/FastCGI Python only).

## 0. Sign up and pick a tier

Go to dreamhost.com and order a Self-Managed VPS. For this app's traffic
(a small team reviewing images, not public high-volume), **VPS Basic /
Stack 4** is enough to start (~$9-16/mo depending on current promo
pricing) — you can resize later from the panel without reprovisioning.
You'll get root SSH access and a public IP once it's provisioned.

## 1. Point a domain/subdomain at it

In the DreamHost panel, add an A record for the (sub)domain you want to
use (e.g. `reviewer.yourdomain.com`) pointing at the VPS's IP. DNS can
take a few minutes to a few hours to propagate.

## 2. First-time server setup (one-time, via SSH)

```bash
ssh yourusername@yourvps.dreamhost.com

sudo apt-get update
sudo apt-get install -y python3-venv python3-pip nginx git apache2-utils certbot python3-certbot-nginx

# Let your user's systemd services keep running after you log out
loginctl enable-linger $USER
```

## 3. Set up git-push deploys (mirrors the Heroku-style workflow)

On the VPS:

```bash
mkdir -p ~/reviewer.git && cd ~/reviewer.git && git init --bare
```

Copy `deploy/post-receive` into `~/reviewer.git/hooks/post-receive` on the
VPS, edit the `APP_DIR` and `SERVICE_NAME` placeholders at the top, then:

```bash
chmod +x ~/reviewer.git/hooks/post-receive
```

Back on your local machine, inside the project folder:

```bash
git remote add dreamhost ssh://yourusername@yourvps.dreamhost.com/~/reviewer.git
```

From now on, `git push dreamhost main` checks the code out on the VPS,
installs dependencies into a venv, and restarts the app service —
the same one-command deploy you wanted from Heroku.

## 4. First deploy

```bash
git push dreamhost main
```

This will fail on the very first push because the systemd service and
`.env` don't exist on the VPS yet — that's expected, do steps 5-6 below,
then push again (or just restart the service manually once).

## 5. Configure the app on the VPS

```bash
cd REPLACE_WITH_APP_DIR   # wherever post-receive checked it out, e.g. ~/ai-image-reviewer
cp .env.example .env
nano .env   # paste your real ANTHROPIC_API_KEY
```

## 6. Install the systemd service

Copy `deploy/gunicorn-reviewer.service` to
`~/.config/systemd/user/gunicorn-reviewer.service` on the VPS, replacing
`REPLACE_WITH_APP_DIR` with your actual app path, then:

```bash
mkdir -p ~/.config/systemd/user
systemctl --user daemon-reload
systemctl --user enable --now gunicorn-reviewer
systemctl --user status gunicorn-reviewer   # confirm it's running
```

## 7. Set up Nginx + basic auth

Create the password file (pick your own username):

```bash
sudo htpasswd -c /etc/nginx/.htpasswd-reviewer yourusername
```

Copy `deploy/nginx-reviewer.conf` to
`/etc/nginx/sites-available/reviewer.conf`, replace
`REPLACE_WITH_DOMAIN` with your real domain, then:

```bash
sudo ln -s /etc/nginx/sites-available/reviewer.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Visit `http://yourdomain.com` — you should get a username/password
prompt, then the app.

## 8. Add HTTPS (recommended before real use)

```bash
sudo certbot --nginx -d yourdomain.com
```

Certbot edits the Nginx config to add TLS and redirect HTTP to HTTPS
automatically. Basic auth stays in effect.

## Day-to-day: shipping updates

From your local machine:

```bash
git add -A
git commit -m "your change"
git push dreamhost main
```

That's it — the post-receive hook reinstalls dependencies (only if
`requirements.txt` changed, pip is a no-op otherwise) and restarts the
service.

## Data persistence note

Unlike Heroku, the VPS disk is permanent — `data/reviewer.db` and the
saved images survive restarts, deploys, and reboots indefinitely. Still
worth backing up periodically, e.g. a cron job that copies `data/` to
DreamHost's included backup storage or downloads it via `scp`/`rsync`.

## Troubleshooting

- **502 Bad Gateway from Nginx** — the app isn't running. Check
  `systemctl --user status gunicorn-reviewer` and
  `journalctl --user -u gunicorn-reviewer -n 50`.
- **`git push dreamhost main` hangs or asks for a password every time**
  — set up an SSH key and add it to the VPS's `~/.ssh/authorized_keys`
  instead of password auth.
- **Service doesn't survive a reboot / SSH logout** — confirm
  `loginctl enable-linger $USER` was run, and that the service was
  enabled with `systemctl --user enable` (not just `--now`).
- **Basic auth prompt never appears** — check the `auth_basic_user_file`
  path matches exactly what you passed to `htpasswd -c`, and that
  `nginx -t` reported no errors before reloading.
