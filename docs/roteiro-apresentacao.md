# Roteiro de demonstração e capturas

Abra um terminal na raiz desta entrega. Reserve cerca de cinco minutos após baixar as imagens.

1. **Explicar a adaptação:** “Reaproveitamos o Kanban com Nginx e API Node.js. Para esta atividade, o banco passou a ser SQLite, persistido em volume nomeado.”
2. **Mostrar `api/Dockerfile`:** base `node:22-alpine`, criação de `appgroup`/`appuser`, IDs 10001, posse de `/app/data` e instrução `USER`. O ID numérico resolve para `appuser`.
3. **Mostrar `docker-compose.yml`:** `read_only`, `cap_drop`, `no-new-privileges`, `tmpfs` e volume nomeado.
4. **Executar Hadolint** e mostrar ausência de diagnósticos e código 0. Salvar log ou captura.
5. **Iniciar a stack:** `docker compose up -d --build --wait`.

## Captura obrigatória: usuário

```sh
docker exec -it backend_api whoami
docker exec -it backend_api id
```

Resultado esperado: `appuser`; UID/GID `10001`. Capture o terminal com comando e saída e salve como `evidencias/01-usuario.png`.

## Captura obrigatória: escrita na raiz negada

```sh
docker exec -it backend_api touch /teste.txt
```

Resultado esperado: erro contendo `Read-only file system`. O comando **deve falhar**. Capture como `evidencias/02-read-only.png`.

## Capturas: frontend e SQLite

1. Abra http://localhost:8080, faça login e crie uma tarefa com título identificável, por exemplo “Hardening validado — SQLite”.
2. Mova a tarefa para “Em andamento” e capture a tela.
3. Mostre o banco:

```sh
docker exec -it backend_api ls -ln /app/data/app.db
docker exec -it backend_api node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/app/data/app.db',{readOnly:true}); console.table(db.prepare('SELECT id,title,status FROM tasks').all()); db.close()"
```

4. Recrie os contêineres mantendo o volume:

```sh
docker compose up -d --force-recreate --wait
```

5. Atualize o navegador e comprove que a tarefa continua no quadro, na mesma coluna. Capture como `evidencias/03-persistencia.png`.

## Perguntas que podem aparecer

- **Por que não-root?** Limita os privilégios do processo; não elimina todos os riscos.
- **Por que `read_only` além de não-root?** Impede alterar a raiz do contêiner mesmo em caminhos que seriam graváveis pelo usuário.
- **Por que o SQLite continua funcionando?** O volume em `/app/data` continua gravável por UID/GID 10001.
- **Para que `cap_drop`?** Remove capacidades adicionais do kernel Linux do processo.
- **Para que `no-new-privileges`?** Impede adquirir novos privilégios durante `exec`, inclusive por SUID e file capabilities.
- **Por que `/tmp`?** Disponibiliza temporários efêmeros em tmpfs sem tornar a raiz gravável.
- **Por que não há contêiner de banco?** SQLite é embarcado; o arquivo fica no volume montado na API.
- **O log nativo substitui o comando pedido?** Não. Execute também o Hadolint pela imagem Docker para cumprir literalmente o roteiro.

## Conferência da entrega

- `api/Dockerfile` e `docker-compose.yml`.
- Código necessário para executar o Kanban e dependências travadas no lockfile.
- Log do Hadolint **via Docker** aprovado.
- Imagens reais de `whoami` e `touch /teste.txt`.
- Evidência de gravação pelo frontend e persistência após recriar os contêineres (`03-frontend-gravacao.png` e `04-frontend-apos-recriar.png`).
- Documentação e identificação dos integrantes em `nomes.txt` (confira os nomes antes de entregar).

Não use evidências do projeto do semestre anterior como comprovação desta versão. Gere as capturas e os logs com os arquivos atuais.

## Evidências já geradas

Os testes desta versão foram concluídos e estão indexados em `evidencias/STATUS.md`. `01-usuario.png` e `02-read-only.png` registram os resultados reais em relatórios visuais com logs anexos; para mostrar também o terminal nativo durante a apresentação, execute os comandos interativos acima. `00-hadolint-docker.log` comprova o quality gate via Docker com código zero.
