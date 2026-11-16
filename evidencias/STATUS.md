# Estado real da validação — 16/11/2026

## Executado com sucesso

- Hadolint **nativo Windows**, versão 2.15.1: nenhum diagnóstico, exit code 0. Binário obtido do repositório oficial e verificado contra o SHA-256 publicado. Registro: `hadolint-nativo.log`.
- `docker compose config --quiet`: exit code 0.
- Testes Node.js: **19 aprovados**, incluindo autenticação, isolamento, CRUD e SQLite real reaberto do disco. Registros: `testes-api.log` (Node 24) e `testes-node22.log` (Node 22).
- `npm audit --omit=dev`: zero vulnerabilidades reportadas na consulta realizada. Isso não equivale a uma auditoria da imagem Docker.
- Script PowerShell de validação: sintaxe verificada.

## Validação em Docker concluída

Após a configuração do WSL pelo usuário, os testes foram executados em **16/11/2026, entre 19:57 e 20:00 (America/Sao_Paulo)**, com Docker Engine 29.9.3.

| Teste | Resultado real | Evidência |
| --- | --- | --- |
| Hadolint via imagem Docker, lendo `api/Dockerfile` pelo stdin | Sem diagnósticos, exit code 0 | `00-hadolint-docker.log` e `.png` |
| `docker exec backend_api whoami` | `appuser` | `01-usuario.png`, `.log` e `.json` |
| UID/GID | 10001 / 10001 | `01-usuario.log` |
| `docker exec backend_api touch /teste.txt` | `Read-only file system`, exit code 1 esperado | `02-read-only.png`, `.log` e `.json` |
| Capabilities e elevação de privilégios | `CapEff: 0000000000000000`, `NoNewPrivs: 1` | `validacao-20261116-195730.log` |
| tmpfs e volume | `/tmp` gravável e efêmero; `/app/data` volume nomeado gravável | Script de validação aprovado |
| Gravação pelo formulário do frontend | POST retornou HTTP 201; tarefa criada em “Em andamento” | `03-frontend-gravacao.png` |
| Persistência após recriar contêineres | Mesmo ID, título e status no SQLite e na interface | `04-frontend-apos-recriar.png`, `05-sqlite-persistencia.log`, `frontend-persistencia.json` |

As imagens `03` e `04` são capturas reais da interface no navegador. As imagens `00`, `01`, `02` e `05` são capturas de relatórios gerados a partir do stdout/stderr de comandos realmente executados, e estão identificadas dessa forma; não são fotografias do terminal do Windows. Os respectivos `.log` e `.json` preservam os resultados. A execução automatizada omite `-it` porque não necessita de terminal interativo; os comandos da apresentação com `-it` estão no roteiro.

O teste comparou IDs diferentes do contêiner da API antes e depois da recriação e conferiu o mesmo registro diretamente em `/app/data/app.db`. Os contêineres ficaram em execução em http://localhost:8080, com as tarefas de demonstração preservadas.

Não há pendências de execução dos testes desta atividade. Para reproduzir ao vivo, seguir `docs/roteiro-apresentacao.md`.
