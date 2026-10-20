# KBC Momentum – MCP server

Lets a customer's own AI (Claude, ChatGPT, Codex, Cursor, …) share a life moment with KBC, read what KBC prepares for it, and revoke it.
Spec: [KBC Momentum – Technisch document › KBC MCP-server](https://github.com/in4matics-tectonic/docs/wiki/KBC-Momentum-%E2%80%93-Technisch-document).
All data comes from the [backend API](https://github.com/in4matics-tectonic/backend). This server only calls the backend and stores nothing itself.

| Tool | What it does | Backend call |
| --- | --- | --- |
| `share_life_moment` | `{moment, fase, verwachte_maand?, klant_akkoord: true}` → signal `EIGEN_AI`, returns `nuttige_info` for the customer | `POST /v1/klanten/:id/momenten/delen` |
| `get_moment_plan` | Read-only: score, phase, actions (only after confirmation in KBC Mobile). Omit `moment` to list them all | `GET /v1/klanten/:id/momenten[/:moment]` |
| `revoke_moment` | Deletes **all** signals of that moment | `DELETE /v1/klanten/:id/momenten/:moment` |

`moment`: `GEZINSUITBREIDING | HUIS_KOPEN | TROUWEN | ZAAK_STARTEN | ZAAK_UITBREIDEN`. `fase`: `orienterend | plannend | beslist` (weight 0.35 / 0.55 / 0.85).

## Quick start

```bash
pnpm install
cp .env.example .env     # fill KBC_PASSWORD (= backend DEMO_PASSWORD) and pick the customer (lien / tom / jonas)
pnpm start               # stdio; normally your AI client starts it for you (see below)
```

The backend must be running (`cd ../backend && pnpm dev`, default `http://127.0.0.1:3000`).

## Connect it to an agent

All clients start the same command. Replace `/ABS/PATH` with the path to this folder. Credentials can come from `.env` in this folder, from the `env` block below, or from both.

**Claude Code**

```bash
claude mcp add kbc-momentum -e KBC_USERNAME=lien -e KBC_PASSWORD=... -- pnpm --silent --dir /ABS/PATH start
```

**Claude Desktop / Cursor / Windsurf** (`claude_desktop_config.json`, `.cursor/mcp.json`, …)

```json
{
  "mcpServers": {
    "kbc-momentum": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "/ABS/PATH", "start"],
      "env": { "KBC_API_URL": "http://127.0.0.1:3000", "KBC_USERNAME": "lien", "KBC_PASSWORD": "..." }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.kbc-momentum]
command = "pnpm"
args = ["--silent", "--dir", "/ABS/PATH", "start"]
env = { KBC_API_URL = "http://127.0.0.1:3000", KBC_USERNAME = "lien", KBC_PASSWORD = "..." }
```

**Remote / HTTP** (platforms that take an MCP URL):

```bash
MCP_TRANSPORT=http PORT=3001 pnpm start      # POST http://127.0.0.1:3001/mcp
```

In HTTP mode the server has no credentials of its own. Every request must carry the customer's own backend token as `Authorization: Bearer <token>` (from `POST /v1/auth/login`, valid for 1h). Example with Claude Code:

```bash
claude mcp add --transport http kbc-momentum http://127.0.0.1:3001/mcp --header "Authorization: Bearer $TOKEN"
```

To test interactively, run `npx @modelcontextprotocol/inspector pnpm --dir /ABS/PATH start`.

## Security (PoC level)

- **Acts only as a customer.** The `klantId` always comes from the customer's token and never from the AI's tool input. `adviseur`/`ingest` tokens are refused, so an AI can never see sensitive signals or other customers.
- **Tiny surface.** The server has three tools and no payments, products or account data. The backend enforces roles, consent (`422 no_consent` without `EIGEN_AI` consent) and privacy filtering, including hidden sensitive signals.
- **Explicit consent.** `share_life_moment` requires `klant_akkoord: true`, and the tool descriptions tell the AI to ask the customer first and never share the conversation. `revoke_moment` is marked `destructiveHint`, so clients ask before running it.
- **Secrets.** Credentials live only in env/`.env` (gitignored) and are never logged or returned. Errors are mapped to plain messages without internals.
- **Transport.** The server refuses a non-https backend URL unless it is localhost. HTTP mode binds `127.0.0.1` with DNS-rebinding protection by default. Set `ALLOWED_HOSTS` when exposing it on `0.0.0.0`, and put it behind TLS.
- **Out of scope for the PoC:** the doc's target is OAuth via itsme with scopes `moments:read`/`moments:write` in place of passwords and pasted tokens.
