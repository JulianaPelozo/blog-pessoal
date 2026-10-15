# 📝 Meu Diário — blog pessoal

Blog local para escrever sobre o dia a dia, com textos, humor do dia e imagens anexadas.

## Stack

- **Back-end:** Node.js + Express, API REST
- **Banco:** SQLite nativo do Node (`node:sqlite`), salvo em `data/blog.db`
- **Uploads:** Multer, arquivos salvos em `uploads/`
- **Front-end:** SPA em JavaScript puro (sem build), consome a API via `fetch`, responsivo e com tema claro/escuro

## Como rodar

Requer **Node.js 22.13 ou superior**.

```bash
npm install
npm start          # ou: npm run dev (reinicia ao editar o código)
```

Acesse http://localhost:3000. Para usar outra porta: `PORT=4000 npm start`.

> O servidor escuta só em `127.0.0.1`, então o blog fica acessível apenas no seu computador.
> Para abrir pelo celular na mesma rede Wi-Fi, use `HOST=0.0.0.0 npm start` e acesse `http://IP-DO-PC:3000`
> (atenção: não há login, então qualquer pessoa na rede poderá editar).

## Funcionalidades

- Criar, editar e excluir posts
- Anexar várias imagens (clicar, arrastar e soltar ou colar com Ctrl+V); a primeira vira a capa
- Remover imagens ao editar
- Humor do dia com emoji
- Busca por título/texto e paginação
- Galeria com lightbox (setas do teclado e swipe no celular)
- Tema claro/escuro, aviso ao sair com alterações não salvas, Ctrl+Enter para salvar

## API

| Método | Rota              | Descrição                                                              |
|--------|-------------------|------------------------------------------------------------------------|
| GET    | `/api/posts`      | Lista posts (`?q=busca&page=1&limit=9`)                                |
| GET    | `/api/posts/:id`  | Detalhe de um post                                                     |
| POST   | `/api/posts`      | Cria post (multipart: `title`, `content`, `mood`, `images[]`)          |
| PUT    | `/api/posts/:id`  | Atualiza post (mesmos campos + `removeImages` = JSON com ids)          |
| DELETE | `/api/posts/:id`  | Exclui post e suas imagens                                             |

## Backup

Todo o conteúdo está em duas pastas: `data/` (banco) e `uploads/` (imagens). Copie as duas para fazer backup.
Elas estão no `.gitignore`, então seus posts não vão para o GitHub.
