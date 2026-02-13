# RPO V5 - Memoria do Projeto

> **Referencia**: Template em [TEMPLATE_PROJETO.md](.claude/TEMPLATE_PROJETO.md)

<!-- CHAPTER: 1 Visao Geral -->

## Sobre o Projeto

RPO V5 e um sistema de gestao de vagas e candidatos com Valkey-First Architecture.
Evolucao do RPO-V4, totalmente independente: API propria, Valkey namespace proprio, caches proprios.

A planilha Google Sheets (`1v6MbkDS3afXBkTM1wIF8abf5sm85PHdx4CXyAxovX6Q`) contem uma aba `config_sheet` que armazena TODAS as configuracoes dinamicamente.

## Informacoes Principais

**Versao Atual**: v5.0.0
**Stack**: Node.js + Express + PostgreSQL + Valkey (Redis) + Google Sheets API
**Status**: Infraestrutura completa, aguardando deploy

<!-- CHAPTER: 2 Arquitetura -->

## Arquitetura

### Valkey-First Architecture
1. Apps Script envia dados via POST para a API
2. API grava no Valkey (cache) imediatamente
3. Worker (worker.js) sync Valkey -> PostgreSQL a cada 1s
4. Worker Sheets (worker_sheets_sync.js) sync PostgreSQL -> Google Sheets a cada 60s

### Stack Tecnologico
- **Runtime**: Node.js v22
- **Framework**: Express 4.18
- **Cache**: Valkey (ioredis) - porta 6379, prefixo RPO_V5:
- **Banco**: PostgreSQL 15 (porta 15432, banco HUB, schema RPO_template_v5)
- **Planilha**: Google Sheets API v4 (googleapis)
- **Logger**: Winston + daily-rotate-file (LGPD compliant)
- **Auth**: Bearer token com crypto.timingSafeEqual

### Estrutura de Arquivos
```
RPO/
├── .clasp.json                  # Apps Script config
├── .claspignore
├── .gitignore
├── src/                         # Apps Script (Google Sheets)
│   ├── Code.gs
│   ├── Sidebar.html
│   └── ...
│
└── api/                         # API V5 (Node.js)
    ├── server.js                # Express server (porta 7001)
    ├── valkey_cache.js          # Cache layer (RPO_V5:{schema}:)
    ├── worker.js                # Sync Valkey -> PostgreSQL
    ├── worker_sheets_sync.js    # Sync PostgreSQL -> Google Sheets
    ├── setup.js                 # Setup de schema e tabelas
    ├── package.json
    ├── .env                     # Variaveis de ambiente
    ├── schemas.json             # Schemas ativos
    │
    ├── constants/
    │   ├── index.js             # Re-export central
    │   ├── tables.js            # Nomes de tabelas snake_case
    │   ├── http.js              # HTTP status codes
    │   ├── timeouts.js          # Timeouts
    │   ├── rate-limits.js       # Rate limiting
    │   ├── limits.js            # Limites gerais
    │   ├── messages.js          # Mensagens de erro/sucesso
    │   └── valkey-keys.js       # Patterns de keys do Valkey
    │
    ├── helpers/
    │   ├── db-pool.js           # Pool PostgreSQL (singleton)
    │   ├── db.js                # Sanitizacao SQL (pg-format)
    │   ├── logger.js            # Winston logger (LGPD)
    │   ├── validators.js        # express-validator rules
    │   ├── fields.js            # Campos dinamicos do dicionario
    │   └── config.js            # Le config_sheet (cache 10min)
    │
    ├── middleware/
    │   └── validateSchema.js    # Validacao de schema (X-Schema header)
    │
    ├── routes/
    │   ├── historico.js         # CRUD historico vagas
    │   ├── candidatos.js        # CRUD historico candidatos
    │   └── monitor.js           # Monitoramento de quotas
    │
    └── systemd/
        ├── rpo-v5-api.service
        ├── rpo-v5-worker.service
        └── rpo-v5-worker-sheets.service
```

### Banco de Dados (PostgreSQL)

**Schema**: `RPO_template_v5` no banco `HUB`

| Tabela | PK | Descricao |
|---|---|---|
| config_sheet | config_label | 17 configuracoes (nomes de abas, formato datas, etc) |
| status_vagas | status | 11 status com funcao_sistema, fim_fluxo, sla_1..sla_5 |
| status_candidatos | status | Status de candidatos com funcao_sistema, fim_fluxo |
| dicionario_vagas | nome_fixo | Campos dinamicos (nome_amigavel, tipo_do_dado, grupo_do_campo) |
| dicionario_candidatos | nome_fixo | Campos dinamicos de candidatos |
| historico_vagas | id (SERIAL) | Registros de vagas (requisicao, status, colunas dinamicas) |
| historico_candidatos | id (SERIAL) | Registros de candidatos (id_candidato, status) |
| fallback_vagas | id (SERIAL) | Fallback de vagas (dados JSONB) |
| fallback_candidatos | id (SERIAL) | Fallback de candidatos (dados JSONB) |
| feriados | id (SERIAL) | Feriados (feriado TEXT, data TEXT) |

<!-- CHAPTER: 3 Funcionalidades -->

## Funcionalidades

### API Endpoints

| Metodo | Path | Auth | Descricao |
|---|---|---|---|
| GET | /health | Nao | Status DB + Valkey + API |
| GET | /config | Sim | Retorna config_sheet (17 configs) |
| POST | /historico/vagas | Sim | Inserir registro de vaga |
| POST | /historico/vagas/proposta-recente | Sim | Buscar proposta recente |
| PATCH | /historico/vagas/proposta-status | Sim | Atualizar status proposta |
| PATCH | /historico/vagas/candidatos-dados | Sim | Atualizar dados candidatos |
| PATCH | /historico/vagas/selecionado-dados | Sim | Atualizar dados selecionado |
| PATCH | /historico/vagas/linha/:id | Sim | Atualizar linha por ID |
| GET | /historico/vagas/lista | Sim | Listar vagas |
| POST | /historico/candidatos | Sim | Inserir candidato |
| PATCH | /historico/candidatos/linha/:id | Sim | Atualizar candidato por ID |
| GET | /historico/candidatos/lista | Sim | Listar candidatos |
| GET | /monitor/quotas | Nao | Status de quotas/usage |
| POST | /setup | Sim | Setup vagas (schema + tabelas) |
| POST | /setup-candidatos | Sim | Setup candidatos |

### Valkey Cache (RPO_V5:{schema}:)

Keys pattern: `RPO_V5:{schema}:{tipo}:{id}`
- `hist_vagas:{requisicao}` - Hash com dados da vaga
- `hist_candidatos:{id_candidato}` - Hash com dados do candidato
- `idx:proposta:{proposta}` - Indice proposta -> requisicao
- `status_vagas` - Hash com todos os status
- `status_candidatos` - Hash com todos os status
- `dic_vagas` - Hash com dicionario
- `dic_candidatos` - Hash com dicionario
- `config` - Hash com config_sheet
- `sync_queue` / `sync_queue_candidatos` - Filas de sync

### Rate Limiting

| Limiter | Limite | Janela |
|---|---|---|
| General | 800/min | 1 minuto |
| Read | 500/min | 1 minuto |
| Write | 300/min | 1 minuto |
| Setup | 50/hora | 1 hora |

<!-- CHAPTER: 4 Configuracoes -->

## Configuracoes

### Variaveis de Ambiente (.env)
```
PGHOST=localhost
PGPORT=15432
PGDATABASE=HUB
PGUSER=rpo_user
PGPASSWORD=rpo_super_secret001
PGSCHEMA=RPO_template_v5
VALKEY_HOST=localhost
VALKEY_PORT=6379
VALKEY_PREFIX=RPO_V5
API_PORT=7001
API_TOKEN=wC6EhpT1KaunWWCN52Rnk+pSJRsEQT766/kP0gT0cnQ=
NODE_ENV=production
GOOGLE_APPLICATION_CREDENTIALS=/home/cazouvilela/credenciais/gcp_grupohub_service_account.json
```

### Portas
- **7001**: API Express (mudou de 7000 pois webhook_server.py usa 7000)
- **15432**: PostgreSQL
- **6379**: Valkey/Redis

### Caminhos Importantes
- **API**: `/home/cazouvilela/projetos/RPO/api/`
- **Apps Script**: `/home/cazouvilela/projetos/RPO/src/`
- **Credenciais GCP**: `/home/cazouvilela/credenciais/gcp_grupohub_service_account.json`
- **Planilha**: `1v6MbkDS3afXBkTM1wIF8abf5sm85PHdx4CXyAxovX6Q`

<!-- CHAPTER: 5 Diferencas V4 vs V5 -->

## Diferencas V4 vs V5

| Aspecto | V4 | V5 |
|---|---|---|
| Porta API | 6000 | 7001 |
| Valkey prefix | `{schema}:` | `RPO_V5:{schema}:` |
| Config tabela | `RAW_AIRBYTE_configuracoesGerais` | `config_sheet` |
| Config campos | `Configuracao/Valor` | `config_label/value` |
| Nomes tabelas | CamelCase com prefixo (RAW_/USO_) | snake_case sem prefixo |
| Nomes colunas | camelCase (`nomeFixo`) | snake_case (`nome_fixo`) |
| Schema header | Body/query/params | + X-Schema header |
| SLAs | Tabela separada | Colunas sla_1..sla_5 em status_vagas |
| Candidatos | Inline no server.js | Route separada (routes/candidatos.js) |
| Ngrok rota | /rpo | /rpo-v5 |

<!-- CHAPTER: 6 Troubleshooting -->

## Troubleshooting

### Porta 7000 ocupada
- webhook_server.py (PID varia) ocupa porta 7000
- Solucao: API V5 usa porta 7001

### Setup via CLI desabilitado
- `node setup.js` nao funciona (intencional)
- Usar POST /setup via API com statusData + dicionarioData
- Schema e tabelas podem ser criados via SQL direto (psql)

<!-- CHAPTER: 7 Deploy -->

## Deploy

### Systemd Services
```bash
sudo cp api/systemd/rpo-v5-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rpo-v5-api rpo-v5-worker rpo-v5-worker-sheets
```

### Ngrok
- Adicionar rota /rpo-v5 -> localhost:7001

### Teste rapido
```bash
curl http://localhost:7001/health
curl -H "Authorization: Bearer TOKEN" -H "X-Schema: RPO_template_v5" http://localhost:7001/config
```

<!-- CHAPTER: 8 Proximas Features -->

## Proximas Funcionalidades

- [ ] Deploy dos systemd services
- [ ] Configurar rota ngrok /rpo-v5
- [ ] Conectar Apps Script ao POST /setup
- [ ] Testar fluxo completo: planilha -> API -> Valkey -> PostgreSQL -> planilha
- [ ] Popular status_vagas e dicionario_vagas via POST /setup
- [ ] Popular status_candidatos e dicionario_candidatos via POST /setup-candidatos

<!-- CHAPTER: 9 Referencias -->

## Referencias

- [TEMPLATE_PROJETO.md](.claude/TEMPLATE_PROJETO.md)
- [GUIA_SISTEMA_PROJETOS.md](.claude/GUIA_SISTEMA_PROJETOS.md)
- RPO-V4 (referencia): `/home/cazouvilela/projetos/RPO-V4/api_historico/`

---

**Ultima Atualizacao**: 2026-02-13
**Versao**: 5.0.0
**Status**: Infraestrutura completa, aguardando deploy
