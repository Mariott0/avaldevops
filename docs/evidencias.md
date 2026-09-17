# Evidências de validação da entrega

Validação realizada em **17/09/2026**, com Docker Desktop executando contêineres Linux no Windows. Docker Engine 29.7.2, Compose 5.3.1 e Node.js 22.17.0 no host para os scripts opcionais.

## Resultados observados

| Verificação | Resultado |
| --- | --- |
| `docker compose config --quiet` | Configuração aceita, sem erros |
| `docker-compose config --quiet` | Executável de compatibilidade também aceita a configuração |
| `docker-compose up --build -d --wait --wait-timeout 120` | Imagens construídas e três serviços saudáveis |
| `npm.cmd test` em `backend/` | 18 testes aprovados após adicionar cadastro; autenticação, expiração JWT, validação, isolamento por usuário e contrato HTTP sem PostgreSQL |
| `node scripts/test-api.mjs` | 32 verificações aprovadas através do Nginx, API e PostgreSQL reais |
| `node scripts/test-persistence.mjs` | Contêineres removidos e recriados; volume e registro preservados |
| `docker compose exec -T frontend nginx -t` | Configuração Nginx válida |
| Recursos `/`, `/app.js`, `/styles.css`, `/favicon.svg` | HTTP 200, MIME correto e conteúdo servido idêntico aos arquivos finais |
| `/api/health` através do Nginx | HTTP 200, `{"status":"ok","database":"connected"}` |
| Sintaxe JavaScript e referências da interface | Sem erros de sintaxe; IDs literais referenciados existem no HTML |

O teste real da API confirmou login incorreto com 401, login `admin/admin`, recusa de todas as operações de tarefas sem token, recusa de assinatura JWT adulterada, criação, listagem, movimentação pelos três estados, edição parcial, entradas inválidas, IDs inválidos, tarefas inexistentes e exclusão.

## Persistência: antes e depois

Registro integral, gerado pelo script: [persistencia.json](persistencia.json). O teste terminou em **2026-09-17T23:00:23Z**, ou **20:00:23 em Brasília**, com `success: true`.

| Serviço | ID anterior (prefixo) | ID após recriação (prefixo) |
| --- | --- | --- |
| frontend | `d9a1edc9d5f2` | `2a40ccc5afca` |
| backend | `e620d32a7b37` | `bdba8dc34284` |
| db | `b0f6a4eb827f` | `c7f35d60fa26` |

Antes e depois, o PostgreSQL montou o volume **`avaldevops_postgres_data`** em **`/var/lib/postgresql/data`**. O script confirmou a existência e a igualdade de ID, título, descrição e status `doing` da tarefa **`2e50e03c-9012-414b-b963-18ec9269cc57`** após a recriação.

Os comandos de recriação foram `docker compose down --timeout 15` e `docker compose up -d --wait --wait-timeout 120`. Não foi usada a opção `-v`. Após a verificação bem-sucedida, somente a tarefa criada pelo teste foi removida, deixando o quadro limpo para uso. Para manter uma tarefa como evidência na sua demonstração, rode o script com `--keep-task`.

Na primeira execução, o script encontrou uma conexão HTTP antiga depois de recriar o Nginx. O auxiliar de testes foi corrigido para fechar suas conexões e evitar reutilizar o socket do contêiner removido. A execução registrada acima já usa essa correção e passou integralmente; operações POST não são repetidas automaticamente.

## Isolamento e execução

- Inspeção Docker confirmou `internal=true` em `avaldevops_backend_net`.
- Frontend pertence apenas a `avaldevops_frontend_net`; backend pertence às duas redes; banco pertence apenas à rede interna.
- API e banco apresentam `PortBindings={}`: nenhuma porta publicada no computador.
- Frontend publica somente `127.0.0.1:8080` para a porta 8080 do contêiner.
- API executa como `uid=1000(node)`; frontend como `uid=101(nginx)`. Ambos usam `readOnly=true`.
- O armazenamento PostgreSQL tem tipo `volume` e nome gerenciado pelo Compose, sem bind mount ou volume anônimo.

## Atualização: cadastro de usuários

Após implementar o cadastro, foram aprovados os **18 testes do backend**, repetidas as **32 verificações reais da API** e executado `node scripts/test-registration.mjs --recreate`, com **10 verificações aprovadas**. O [relatório de cadastro](cadastro.json) contém o resultado e o horário da execução, sem senhas ou tokens.

O teste confirmou cadastros simultâneos com o mesmo nome (um 201 e um 409), normalização de nomes, hashes scrypt gravados no PostgreSQL, preservação do login `admin/admin`, validação de entradas, login de novas contas, `/api/auth/me`, criação de tarefas e impedimento de listar, editar ou excluir tarefas de outro usuário. Após `down` sem `-v` e `up`, as contas ainda autenticavam e suas tarefas estavam intactas. Foram removidas somente as duas contas criadas pelo teste, e seus tokens passaram a ser recusados.

A interface passou pela conferência de IDs, referências JavaScript, labels, sintaxe e entrega HTTP dos arquivos atualizados. O fluxo visual de cadastro, confirmação de senha e restauração deve seguir o roteiro manual do README.

## Limites desta validação

O navegador automatizado não estava disponível nesta sessão. Os cliques, arrastar e soltar e o aspecto visual em diferentes telas **não foram executados em navegador**. Foram verificados o código da interface, a sintaxe, seus recursos HTTP e as operações reais da API. A conferência visual e interativa deve seguir o roteiro manual do README; não há capturas de tela apresentadas como evidência.

Os testes sem banco do backend usam um repositório em memória para verificar autenticação e comportamento HTTP. A evidência de persistência é exclusivamente o teste separado com PostgreSQL real e recriação dos contêineres.
