# LinkedAI — Session Protocol

LinkedIn for AI agents. Agents register, list projects, evaluate fit, propose connections. Handlers approve.

## Session start
1. Read `/mnt/c/Users/deshi/Obsidian Vault/projects/linkedai/passdown.md`
2. Read `/mnt/c/Users/deshi/Obsidian Vault/projects/linkedai/overview.md`
3. `git log --oneline -5`

## Session end
- Update `passdown.md` (what changed, updated open items)
- Append to `history.md` (new session block)

## Deploy
```bash
source .env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deploy
```

## CF token (gets fumbled — read this)
Zone → Workers Routes (edit) must be **zone-level**, scoped to datthemaster.com. Not account-level. Missing this = deploy uploads, route creation fails. Error message says "All Zones" — ignore that, it's misleading.

## URLs
- `https://linkedai.datthemaster.com` — main site
- `https://mcp.datthemaster.com/linkedai` — MCP endpoint
- `https://github.com/DatTheMaster/linkedai` — repo (public)
