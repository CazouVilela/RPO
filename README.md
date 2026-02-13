# RPO V5 - Sistema de Gestao de Vagas e Candidatos

Sistema RPO (Recruitment Process Outsourcing) com Valkey-First Architecture para gestao de vagas e candidatos via Google Sheets + API REST.

## Arquitetura

```
Google Sheets (Apps Script) --> API Express (porta 7001) --> Valkey Cache
                                                               |
                                                Worker (1s) --> PostgreSQL
                                                               |
                                          Worker Sheets (60s) --> Google Sheets
```

## Componentes

| Componente | Arquivo | Descricao |
|---|---|---|
| API | `api/server.js` | Express REST API na porta 7001 |
| Cache | `api/valkey_cache.js` | Valkey cache com prefixo RPO_V5: |
| Worker | `api/worker.js` | Sync Valkey -> PostgreSQL (1s) |
| Worker Sheets | `api/worker_sheets_sync.js` | Sync PostgreSQL -> Sheets (60s) |
| Setup | `api/setup.js` | Criacao de schema/tabelas via POST /setup |
| Apps Script | `src/` | Frontend Google Sheets |

## Stack

- **Node.js** v22 + Express 4.18
- **PostgreSQL** 15 (porta 15432, banco HUB, schema RPO_template_v5)
- **Valkey** (Redis-compatible, porta 6379)
- **Google Sheets API** v4
- **Winston** logger (LGPD compliant)

## Instalacao

```bash
cd api
npm install
cp .env.example .env  # configurar variaveis
```

## Uso

```bash
# Iniciar API
node api/server.js

# Iniciar Workers
node api/worker.js
node api/worker_sheets_sync.js

# Testar
curl http://localhost:7001/health
```

## API Endpoints

| Metodo | Path | Auth | Descricao |
|---|---|---|---|
| GET | /health | Nao | Health check |
| GET | /config | Sim | Config sheet |
| POST | /historico/vagas | Sim | Inserir vaga |
| GET | /historico/vagas/lista | Sim | Listar vagas |
| POST | /historico/candidatos | Sim | Inserir candidato |
| GET | /historico/candidatos/lista | Sim | Listar candidatos |
| POST | /setup | Sim | Setup vagas |
| POST | /setup-candidatos | Sim | Setup candidatos |

## Documentacao

Documentacao detalhada em [`/documentacao`](./documentacao) e [`.claude/memory.md`](.claude/memory.md).
