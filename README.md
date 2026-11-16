# Hardening de contêineres — Kanban Em dia

Esta entrega adapta o projeto do semestre anterior aos requisitos de hardening. A interface, cadastro, login JWT e operações do Kanban foram reaproveitados. A persistência foi adaptada de PostgreSQL para **SQLite**, conforme o enunciado atual. Execute os comandos **na pasta que contém este README e o arquivo `docker-compose.yml`**. Dados antigos do PostgreSQL não são migrados.

## Iniciar

Pré-requisitos: Docker Engine com contêineres Linux e Docker Compose. No Windows, inicie o Docker Desktop com seu backend WSL 2 funcionando.

```sh
docker compose up -d --build --wait
```

Abra **http://localhost:8080**. Use `admin` / `admin` para a demonstração ou cadastre uma conta. Crie, edite e mova tarefas. As credenciais e o segredo JWT padrão são didáticos para avaliação local. A porta publicada está restrita ao computador local.

## Arquitetura e controles

```text
Navegador → localhost:8080 → Nginx:8080 → api:3000 → /app/data/app.db
                                                      ↓
                                            volume sqlite_data
```

SQLite é um banco embarcado na API: não precisa de um terceiro contêiner. A porta da API não é publicada no host.

| Exigência | Implementação |
| --- | --- |
| Base oficial leve | `FROM node:22-alpine` em `api/Dockerfile` |
| Grupo dedicado | `appgroup`, GID `10001` |
| Usuário sem root | `appuser`, UID `10001` |
| Diretório gravável | `/app/data` criado no build com posse `appuser:appgroup` |
| USER ativo | `USER 10001:10001`, identidade de `appuser:appgroup` |
| Raiz somente leitura | `read_only: true` |
| Remoção de capabilities | `cap_drop: [ALL]` |
| Bloqueio de elevação | `security_opt: [no-new-privileges:true]` |
| Temporários em memória | `tmpfs` em `/tmp`, com `noexec,nosuid,nodev` e limite de 16 MiB |
| Persistência | Volume nomeado `sqlite_data` em `/app/data` |
| Quality gate | Hadolint, sem ignorar regras; workflow em `.github/workflows/quality-gate.yml` |

`USER` usa IDs numéricos para atender também à regra DL3066 do Hadolint atual. O usuário correspondente está cadastrado na imagem, portanto `whoami` retorna **appuser**. O código e as dependências pertencem a root; a aplicação não precisa alterá-los.

Na primeira montagem de um volume novo, o Docker copia o conteúdo e as permissões do diretório da imagem para o volume. Não usamos `chmod 777`, execução como root ou `chown` na inicialização. SQLite mantém também arquivos auxiliares WAL/SHM no mesmo diretório do banco.

O volume é a área de escrita **persistente** da aplicação. `/tmp` é uma exceção efêmera explicitamente exigida pelo enunciado. `read_only` não transforma volumes e tmpfs em somente leitura. O frontend também mantém raiz somente leitura, usuário Nginx não-root e capabilities removidas.

## Quality gate

Em Bash, execute exatamente o comando solicitado:

```bash
docker run --rm -i hadolint/hadolint < api/Dockerfile
echo $?
```

No PowerShell, `<` não funciona como no Bash. Use:

```powershell
cmd /d /c "docker run --rm -i hadolint/hadolint < api/Dockerfile"
$LASTEXITCODE
```

Critério de aprovação: **nenhum diagnóstico e código de saída 0**. O Hadolint normalmente não imprime uma mensagem de sucesso.

## Testes e evidências para apresentar

Execute o roteiro completo do [guia de apresentação](docs/roteiro-apresentacao.md). No Windows, o script abaixo valida a stack e salva um log com data em `evidencias/`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validar.ps1
```

O script executa Hadolint, inicia a stack, confere usuário e hardening, testa a escrita negada na raiz, grava uma tarefa via Nginx, verifica o arquivo SQLite e recria os contêineres para provar a persistência. Ele preserva o volume e deixa a tarefa de demonstração no quadro. Não substitui as capturas de tela pedidas pelo professor.

Para parar preservando os dados:

```sh
docker compose down
```

Não use `docker compose down -v` na demonstração: `-v` remove os volumes e seus dados.

## Testes locais da aplicação

Com Node.js 22.13+ (ou 24) instalado:

```sh
cd api
npm ci
npm test
```

Há testes de contrato HTTP, autenticação, validação, isolamento entre contas e um teste de integração que grava um arquivo SQLite real e o reabre para verificar persistência. Isso não comprova o isolamento do Docker; essa evidência depende dos testes em contêiner.

## Situação da validação

Validação em Docker concluída em 16/11/2026: Hadolint sem diagnósticos, `appuser`, raiz somente leitura, capabilities removidas, bloqueio de elevação e persistência confirmados. Uma tarefa criada pelo formulário do frontend permaneceu no SQLite e na interface após recriar os contêineres.

Consulte [evidencias/STATUS.md](evidencias/STATUS.md) para o índice das imagens e logs. As capturas do frontend e os relatórios visuais dos comandos estão identificados separadamente. O workflow só executará ao enviar estes arquivos para um repositório GitHub com Actions habilitado.

## Referências

- [Node.js 22: SQLite nativo](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html) — usado na adaptação; recurso ainda experimental na linha Node 22.
- [Hadolint](https://github.com/hadolint/hadolint) — análise estática do Dockerfile.
- [Docker: volumes](https://docs.docker.com/engine/storage/volumes/) — persistência e inicialização de volumes.

O Hadolint analisa Dockerfiles; `docker compose config --quiet` verifica a estrutura do Compose. Nenhum desses comandos, isoladamente, comprova a segurança em execução.
