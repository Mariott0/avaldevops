# Roteiro de demonstração — 5 a 8 minutos

## 1. Apresentar a arquitetura (1 minuto)

Abra o diagrama do README e o `docker-compose.yml`. Explique as três camadas: o Nginx serve a interface, o Node.js aplica as regras e valida o JWT, e o PostgreSQL armazena usuários e tarefas.

Mostre que só existe um `ports`, no frontend. A rede `frontend_net` une frontend e API; a rede interna `backend_net` une API e banco. O nome `db` funciona dentro do Docker porque o Compose oferece resolução DNS entre serviços da mesma rede.

## 2. Subir com um comando (1 minuto)

Execute `docker compose up --build -d --wait` e depois `docker compose ps`. Mostre os três serviços saudáveis. Explique que `depends_on` com `service_healthy` aguarda o banco responder e a API concluir sua inicialização.

## 3. Demonstrar aplicação e JWT (1 a 2 minutos)

Mostre uma tentativa de login incorreta e depois entre com `admin/admin`. Crie uma tarefa, edite-a e mova pelas colunas. Abra a aba Rede do navegador e mostre que a requisição para `/api/tasks` envia `Authorization: Bearer ...`.

Saia e use **Criar conta** para cadastrar um usuário próprio. Mostre a entrada automática e o quadro vazio. Crie uma tarefa e recarregue para conferir a restauração do nome e dos dados. Entre como `admin` novamente: a tarefa da nova conta não aparece porque cada quadro pertence ao usuário autenticado.

Explique: JWT é assinado pelo backend; a assinatura e a validade são verificadas antes de consultar tarefas. Uma alteração no token invalida sua assinatura. Decodificar o conteúdo do JWT não é o mesmo que validar o token. Evite expor o token em gravações ou compartilhamentos.

Execute `node scripts/test-api.mjs`, se o computador tiver Node.js, para mostrar requisições sem token e com token adulterado sendo recusadas.

## 4. Comprovar persistência (2 minutos)

Crie uma tarefa identificável e mova para Em andamento. Mostre o volume com `docker volume inspect avaldevops_postgres_data`. Execute `docker compose down`, depois `docker compose up -d --wait`. Entre novamente e mostre os dados preservados.

Explique: o contêiner foi removido, mas o volume nomeado continuou existindo. O novo contêiner PostgreSQL monta o mesmo volume. A opção `down -v` não serve para este teste porque ela também remove o volume.

Se preferir uma comprovação automática: `node scripts/test-persistence.mjs --keep-task` compara o volume, os IDs dos contêineres e o registro da tarefa e gera um relatório.

## 5. Mostrar qualidade e organização (1 minuto)

Abra os Dockerfiles e destaque `FROM ...alpine`, `WORKDIR`, `COPY`, `EXPOSE` e execução sem root. No backend, copiar os manifests antes do código permite reaproveitar a camada de dependências; `npm ci` respeita o lockfile. No frontend estático, não é necessária uma etapa de compilação.

Mostre `.dockerignore`, `.gitignore`, documentação e `nomes.txt`. Encerre explicando que o avaliador precisa somente extrair o ZIP e executar o Compose.

## Perguntas que o grupo deve saber responder

| Pergunta | Explicação |
| --- | --- |
| Por que o frontend não usa `localhost:3000`? | No navegador, localhost seria o computador; no Nginx, seria o próprio contêiner. O proxy usa `backend:3000` no DNS do Docker. |
| Por que não ocorreu CORS? | Página e API são acessadas pelo navegador na mesma origem, em localhost:8080. |
| `EXPOSE` publica uma porta? | Não. A publicação no host é configurada com `ports`. |
| O que persiste quando um contêiner é removido? | Os arquivos gravados no volume nomeado; alterações somente no filesystem do contêiner são descartáveis. |
| Por que ter healthcheck além de depends_on? | Um processo pode ter iniciado antes de estar pronto para responder. A condição service_healthy aguarda prontidão. |
| O banco pode ser acessado diretamente do navegador? | Não há porta do banco publicada, e o frontend não participa da rede interna do banco. |
