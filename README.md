# Hotspot password portal

A single-page English portal for users to change their own **local MikroTik hotspot account password**. Node.js serves the page and communicates with RouterOS v7 over its HTTPS REST API. No dependencies, database, or frontend build step are required.

## Run locally

Requires Node.js 22 or newer.

```sh
cp .env.example .env
# Edit .env with your router settings.
npm start
```

Open `http://localhost:3000`. The interface can be previewed without router configuration; submissions return a clear unavailable message until configuration is supplied.

```dotenv
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
MIKROTIK_URL=https://192.168.88.1
MIKROTIK_USERNAME=hotspot-portal
MIKROTIK_PASSWORD=your-router-api-password
```

`MIKROTIK_URL` is the router HTTPS origin, without `/rest`. `PUBLIC_ORIGIN` must match the exact browser origin, including the scheme and port. Keep `.env` private.

## MikroTik preparation

1. Use RouterOS v7 with the `www-ssl` service enabled and a valid TLS certificate. Restrict the service and firewall to the portal server's IP. Do not expose the router REST API to hotspot clients or the public internet.
2. Create a dedicated router API account. It needs the `rest-api`, `read`, `write`, and `sensitive` policies to retrieve the local hotspot password and update it. RouterOS policy permissions are broad; restrict this account's allowed address to the portal server. Verify the assigned policies against your RouterOS release.
3. Accounts must be stored under `/ip/hotspot/user`. RADIUS and User Manager accounts require a different integration. This changes the individual hotspot login password, not the shared wireless network key.
4. For a private certificate authority, set `NODE_EXTRA_CA_CERTS` to its PEM certificate path. TLS certificate validation remains enabled.

The backend queries the exact username with a limited property list, compares the submitted current password on the server, and PATCHes only the matched record ID. Router credentials, retrieved passwords, and router error details are never returned to the browser or logged.

Reference: [MikroTik REST API documentation](https://manual.mikrotik.com/docs/developer-guides/rest-api/).

## Deployment

Run a single Node process behind an HTTPS reverse proxy. Set `PUBLIC_ORIGIN` to the public HTTPS origin, such as `https://wifi.example.com`. Keep the Node listener private and forward requests from the proxy. The portal serves its own scripts, styles, and graphics, so it requires no external asset domains.

### New VM with Docker Compose

This repository includes [compose.yaml](compose.yaml) and [Caddyfile](Caddyfile). Caddy obtains and renews the public TLS certificate automatically, and the portal container is accessible only through Caddy.

Requirements:

- A Linux VM with Docker Engine and the Docker Compose plugin.
- A public DNS record, for example `wifi.clairty.example`, pointing to the VM.
- TCP ports 80 and 443 open to the VM.
- Network access from the VM to RouterOS HTTPS port 443. For a remote VPS, use a private VPN such as WireGuard rather than exposing the RouterOS REST API publicly.

Copy the project to the VM, then configure it:

```sh
cd portal
cp .env.vm.example .env
mkdir -p certs
nano .env
```

Set these values in `.env`:

```dotenv
PORTAL_DOMAIN=wifi.clairty.example
MIKROTIK_URL=https://router.clairty.example
MIKROTIK_USERNAME=clairty-portal
MIKROTIK_PASSWORD=a-long-random-password
NODE_EXTRA_CA_CERTS=
```

If the RouterOS `www-ssl` certificate uses a private CA, copy the CA certificate to `certs/router-ca.pem` and set:

```dotenv
NODE_EXTRA_CA_CERTS=/certs/router-ca.pem
```

Validate and start the stack:

```sh
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100 portal caddy
```

Open `https://wifi.clairty.example`. Useful maintenance commands:

```sh
docker compose pull
docker compose build --pull
docker compose up -d
docker compose logs -f --tail=100
docker compose down
```

`docker compose down` stops the portal but preserves Caddy certificates. Do not use `down -v` unless you intentionally want to delete those certificates.

On RouterOS, create a dedicated API user and restrict it to the VM or VPN address:

```routeros
/user/group/add name=clairty-portal policy=read,write,sensitive,rest-api
/user/add name=clairty-portal group=clairty-portal password="REPLACE_WITH_THE_SAME_LONG_PASSWORD" address=VM_OR_VPN_IP/32
/ip/service/enable www-ssl
```

Allow TCP 443 from that VM address in the RouterOS input firewall. Keep `www` disabled and do not expose `www-ssl` to the public internet. The hostname in `MIKROTIK_URL` must match the RouterOS TLS certificate.

If users must reach the portal before hotspot login, add the portal hostname/IP to your hotspot walled garden. Verify the HTTPS certificate and captive portal behavior with your actual network.

The app limits each source IP and each username to 10 attempts per 15 minutes, including successful requests. The supplied Compose deployment enables trusted-proxy handling because the portal is reachable only through its private Caddy network. Do not expose port 3000 when `TRUST_PROXY=true`. Counters are in memory and reset at restart; use a shared limiter before running multiple instances. Password changes for the same account are serialized within the process.

Existing hotspot sessions and remembered router cookies are left in place. A password change applies to future password-based sign-ins; it does not revoke already authenticated devices. Use network administration tools if session revocation is required.

## Run directly on MikroTik

The portal can run on the router itself using the RouterOS v7 Container package. The router must use a supported `arm`, `arm64`, or `x86` architecture, have enough RAM, and preferably have external storage. MIPS, MMIPS, SMIPS, TILE, and PPC models cannot run this container. Check with:

```routeros
/system/resource/print
/system/package/print where name=container
```

The supplied setup uses an isolated `172.31.250.0/30` container network, exposes the portal on HTTPS port `8443`, permits the container to reach only the router REST endpoint, and starts the portal after router reboots.

### 1. Prepare TLS certificates

Create `disk1/clairty-certs/` on the router and upload these files:

- `portal.crt` and `portal.key`: certificate and private key for the hostname users open, such as `wifi.clairty.example`.
- `router-ca.pem`: CA certificate that signed the RouterOS `www-ssl` certificate.

The portal certificate must match the hostname in `portalOrigin`. The RouterOS certificate must match the hostname in `routerApiUrl`. This protects users' old and new passwords and keeps certificate verification enabled.

### 2. Build the image for the router CPU

```sh
chmod +x scripts/build-routeros-image.sh
./scripts/build-routeros-image.sh arm64
```

Accepted targets are `arm64`, `arm/v7`, and `amd64`. Upload the resulting `clairty-portal-<architecture>.tar` file to `disk1/` using WinBox, SFTP, or SCP.

### 3. Enable and install Container

Install the RouterOS `container` package for the router's architecture. Container mode is disabled by default and enabling it requires physical confirmation or a cold reboot:

```routeros
/system/device-mode/update container=yes
```

Copy [routeros/install.rsc](routeros/install.rsc), edit the five values at the top, upload it to the router, and import it:

```routeros
/import file-name=install.rsc
/container/print
```

When extraction finishes and the status becomes `stopped`, start it:

```routeros
/container/start [find where name=clairty-portal]
```

Open the `portalOrigin` address in a client browser. Add that hostname or container destination to the hotspot walled garden if users need the portal before authenticating.

The installation script assumes an interface list named `LAN`, external storage named `disk1`, HTTPS REST on TCP 443, and that `172.31.250.0/30` is unused. Adjust those values if the router differs. The script creates a dedicated RouterOS user restricted to the container IP. Delete the uploaded `install.rsc` after import because it contains the generated API password.

## Checks

```sh
npm test
```

Tests run the real portal HTTP server against a simulated MikroTik REST server. They cover successful changes, credential failures, disabled accounts, validation, origin checks, rate limiting, protected files, and upstream failures. A real router is still required to validate certificate trust, account permissions, and hotspot sign-in behavior on your network.
