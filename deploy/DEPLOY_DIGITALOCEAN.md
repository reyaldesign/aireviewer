# Deploying to a DigitalOcean Droplet

This app needs a persistent Python process and a writable local disk (for
the SQLite database and uploaded images), so it needs a real VPS. A
DigitalOcean Droplet works well and is cheaper than DreamHost's VPS
tier for the same job.

## 0. Create a DigitalOcean account and Droplet

1. Sign up at digitalocean.com and add a payment method.
2. Click **Create > Droplets**.
3. Image: **Ubuntu 22.04 (LTS) x64**.
4. Plan: **Basic**, Regular SSD, **$6/mo** (1GB RAM / 25GB SSD / 1000GB
   transfer). The $4/mo tier is too tight once you're running
   Gunicorn + Nginx + Claude API calls together.
5. Datacenter region: pick whichever is closest to your team.
6. Authentication: **SSH key** is strongly recommended over password
   (upload your public key, or generate one first with `ssh-keygen`).
7. Hostname: something like `ai-image-reviewer`.
8. Create the Droplet. You'll get a public IPv4 address within about a
   minute.

## 1. Point your domain at it

Once you've registered a domain (through DigitalOcean, Namecheap,
or any registrar), add an **A record** pointing your (sub)domain at the
Droplet's IP address:

- If the domain is registered elsewhere: add the A record in that
  registrar's DNS settings.
- If you add the domain to DigitalOcean's Networking > Domains panel,
  DO manages the DNS for you and it's a couple of clicks.

DNS can take a few minutes to a few hours to propagate.

## 2. First-time server setup (one-time, via SSH)

```bash
ssh root@your.droplet.ip
```

Create a non-root user to run the app under (best practice, and
required for the systemd `--user` service approach below):

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copy your SSH key over
```

Log out and back in as `deploy` from here on:

```bash
ssh deploy@your.droplet.ip

sudo apt-get update
sudo apt-get install -y python3-venv python3-pip nginx git apache2-utils certbot python3-certbot-nginx

# Let your user's systemd services keep running after you log out
sudo loginctl enable-linger deploy
```

## 3. Set up git-push deploys

```bash
mkdir -p ~/reviewer.git && cd ~/reviewer.git && git init --bare
```

Copy `deploy/post-receive` into `~/reviewer.git/hooks/post-receive`,
edit the `APP_DIR` and `SERVICE_NAME` placeholders at the top, then:

```bash
chmod +x ~/reviewer.git/hooks/post-receive
```

Back on your local machine, inside the project folder:

```bash
git remote add production ssh://deploy@your.droplet.ip/~/reviewer.git
```

From now on, `git push production main` checks the code out on the
Droplet, installs dependencies into a venv, and restarts the app
service.

## 4. First deploy

```bash
git push production main
```

This will fail the very first time since the systemd service and `.env`
don't exist on the server yet, that's expected. Do steps 5-6 below, then
push again (or just restart the service manually once).

## 5. Configure the app on the server

```bash
cd REPLACE_WITH_APP_DIR   # wherever post-receive checked it out, e.g. ~/ai-image-reviewer
cp .env.example .env
nano .env   # paste your real ANTHROPIC_API_KEY
```

## 6. Install the systemd service

Copy `deploy/gunicorn-reviewer.service` to
`~/.config/systemd/user/gunicorn-reviewer.service`, replacing
`REPLACE_WITH_APP_DIR` with your actual app path, then:

```bash
mkdir -p ~/.config/systemd/user
systemctl --user daemon-reload
systemctl --user enable --now gunicorn-reviewer
systemctl --user status gunicorn-reviewer   # confirm it's running
```

## 7. Set up Nginx + basic auth

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

Visit `http://yourdomain.com`, you should get a username/password
prompt, then the app.

## 8. Add HTTPS (recommended before real use)

```bash
sudo certbot --nginx -d yourdomain.com
```

Certbot edits the Nginx config to add TLS and redirect HTTP to HTTPS
automatically. Basic auth stays in effect.

## 9. Lock down the firewall (recommended)

DigitalOcean Droplets have no firewall by default. Add one in the
Networking > Firewalls panel, or via `ufw`:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Day-to-day: shipping updates

```bash
git add -A
git commit -m "your change"
git push production main
```

The post-receive hook reinstalls dependencies (only if
`requirements.txt` changed) and restarts the service.

## Data persistence note

The Droplet's disk is permanent, `data/reviewer.db` and the saved
images survive restarts, deploys, and reboots. Still worth backing up
periodically, e.g. DigitalOcean's Droplet backups (small extra monthly
fee) or a cron job that `rsync`s `data/` somewhere else.

## Troubleshooting

- **502 Bad Gateway from Nginx** - the app isn't running. Check
  `systemctl --user status gunicorn-reviewer` and
  `journalctl --user -u gunicorn-reviewer -n 50`.
- **`git push production main` hangs or asks for a password every
  time** - confirm your SSH key was copied to the `deploy` user (not
  just `root`) during step 2.
- **Service doesn't survive a reboot / SSH logout** - confirm
  `sudo loginctl enable-linger deploy` was run, and the service was
  enabled with `systemctl --user enable` (not just `--now`).
- **Basic auth prompt never appears** - check the `auth_basic_user_file`
  path matches exactly what you passed to `htpasswd -c`, and that
  `nginx -t` reported no errors before reloading.
- **Can't reach the site at all** - check the firewall (step 9) is
  allowing port 80/443, and that the A record has finished propagating
  (`dig yourdomain.com` should show the Droplet's IP).
