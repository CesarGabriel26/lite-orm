# lite-orm

Mini ORM moderna, tipada e de alta performance focada exclusivamente no **PostgreSQL**, com resolução de relacionamentos nativa via `JSONB` (`jsonb_build_object` e `jsonb_agg`), transações simplificadas e Query Builder expressivo.

---

## 🚀 Destaques

- **Zero N+1 Queries**: Relacionamentos resolvidos diretamente no PostgreSQL via JSONB em uma única query.
- **Repository Simplificado**: Instancie repositórios apenas informando a Entidade (`new Repository(User)` ou `getRepository(User)`).
- **Sem Contagens Desnecessárias**:
  - `repo.find()`: Retorna a **lista pura** (`T[]`) sem overhead de contagem.
  - `repo.paginate()`: Retorna os registros com contagem e metadados de paginação calculados.
- **Postgres-First**:
  - Suporte a `UPSERT` nativo (`ON CONFLICT (...) DO UPDATE ... RETURNING *`).
  - Suporte a `RETURNING` em inserções, atualizações e deleções (`deleteAndReturn`).
  - Operadores PostgreSQL nativos: `$ilike`, `$between`, `$any` (array/jsonb `@>`), e `$tsquery` (Full Text Search).
- **Transações Atômicas Seguras**: Suporte a escopo transacional direto no repositório (`tx.getRepository(User)`).

---

## 📦 Instalação

```bash
npm install @raymondfox/lite-orm pg
npm install -D @types/pg
```

---

## ⚙️ Configuração da Conexão

A biblioteca resolve a conexão automaticamente seguindo esta ordem de prioridade:

1. **Setup manual no código** via `initDatabase(...)`:
   ```typescript
   import { initDatabase } from 'lite-orm';

   // Via string de conexão:
   initDatabase('postgresql://user:pass@localhost:5432/mydb');

   // Ou via objeto de configuração:
   initDatabase({
       host: 'localhost',
       port: 5432,
       user: 'postgres',
       password: 'secretpassword',
       database: 'mydb',
       max: 20
   });
   ```

2. **Variáveis de ambiente soltas (Padrão libpq/PostgreSQL)**:
   Se existirem no `process.env`, são utilizadas diretamente:
   - `PGHOST` (ou `POSTGRES_HOST`)
   - `PGPORT` (ou `POSTGRES_PORT`)
   - `PGUSER` (ou `POSTGRES_USER`)
   - `PGPASSWORD` (ou `POSTGRES_PASSWORD`)
   - `PGDATABASE` (ou `POSTGRES_DB` / `POSTGRES_DATABASE`)
   - `PGSSL` ou `PGSSLMODE`

3. **URL de Conexão no ambiente**:
   - `DATABASE_URL` ou `PG_DATABASE_URL` ou `POSTGRES_URL`

4. **Fallback Local**:
   - `localhost:5432` com usuário `postgres` e banco `postgres`.

---

## 🏛️ Definindo Entidades

Utilize decorators TypeScript para mapear classes e propriedades para tabelas e colunas do PostgreSQL:

```typescript
import {
    table,
    field,
    oneToOne,
    oneToMany,
    manyToOne,
    FieldType
} from 'lite-orm';

// 1. Tabela de Perfil
@table('profiles')
export class Profile {
    @field({ primaryKey: true })
    id!: number;

    @field()
    userId!: number;

    @field()
    bio!: string;
}

// 2. Tabela de Posts
@table('posts')
export class Post {
    @field({ primaryKey: true })
    id!: number;

    @field()
    title!: string;

    @field()
    authorId!: number;

    // Relação N:1 -> Post pertence a um Autor
    @manyToOne({
        entity: () => User,
        localField: 'authorId',
        foreignField: 'id',
        alias: 'author'
    })
    author?: User;
}

// 3. Tabela de Usuários
@table('users')
export class User {
    @field({ primaryKey: true })
    id!: number;

    @field()
    name!: string;

    @field()
    email!: string;

    // Relação 1:1 -> Usuário possui um Perfil
    @oneToOne({
        entity: () => Profile,
        localField: 'id',
        foreignField: 'userId',
        alias: 'profile'
    })
    profile?: Profile;

    // Relação 1:N -> Usuário possui múltiplos Posts
    @oneToMany({
        entity: () => Post,
        localField: 'id',
        foreignField: 'authorId',
        alias: 'posts'
    })
    posts?: Post[];
}
```

---

## 🔗 Como Funcionam os Decorators de Relacionamento

A ORM elimina o clássico problema de $N+1$ queries agrupando e construindo os dados relacionados diretamente na engine do PostgreSQL:

| Decorator | Cardinalidade | Como o PostgreSQL Resolve | Retorno no TypeScript |
| :--- | :--- | :--- | :--- |
| `@manyToOne` | N : 1 | `LEFT JOIN` + `CASE WHEN ... IS NULL THEN NULL ELSE jsonb_build_object(...) END` | Objeto `{ ... }` ou `null` |
| `@oneToOne` | 1 : 1 | `LEFT JOIN` + `CASE WHEN ... IS NULL THEN NULL ELSE jsonb_build_object(...) END` | Objeto `{ ... }` ou `null` |
| `@oneToMany` | 1 : N | `LEFT JOIN` + `COALESCE(jsonb_agg(jsonb_build_object(...)) FILTER (...), '[]'::jsonb)` + `GROUP BY` | Array `[{ ... }]` |

### Parâmetros dos Relacionamentos:
- `entity`: Referência para a classe da entidade alvo (use arrow function `() => TargetEntity` para evitar dependências circulares).
- `localField`: Nome da propriedade local que contém a chave.
- `foreignField`: Nome da propriedade remota que corresponde à chave.
- `alias`: Apelido opcional da relação no SQL gerado.

---

## 🛠️ Uso do Repositório (`Repository`)

Você **não precisa** passar o pool ao criar repositórios:

```typescript
import { Repository, getRepository } from 'lite-orm';
import { User } from './entities/User';

// Instanciação direta:
const userRepo = new Repository(User);

// Ou via helper factory:
const userRepo = getRepository(User);
```

### 1. Listagem Pura (`find`)
Retorna apenas o array puro de registros (`T[]`). Não executa queries de contagem (`COUNT`):

```typescript
// Lista todos os usuários
const users = await userRepo.find();

// Com filtros e seleção de relacionamentos
const activeUsers = await userRepo.find({
    filters: {
        email: { $ilike: '%@empresa.com' }
    },
    fields: {
        $include: [
            'id',
            'name',
            'profile.bio',      // Carrega o relacionamento 1:1
            'posts.id',         // Carrega os posts 1:N
            'posts.title'
        ]
    },
    sort: {
        name: 'asc'
    },
    limit: 10
});
```

### 2. Listagem Paginada (`paginate`)
Executa a busca com `LIMIT` / `OFFSET` e calcula o total de páginas e itens:

```typescript
const result = await userRepo.paginate({
    page: 1,
    pageSize: 15,
    filters: {
        name: { $ilike: 'Ana%' }
    }
});

console.log(result.items); // User[]
console.log(result.pagination);
// {
//   pageIndex: 1,
//   pageSize: 15,
//   totalItems: 42,
//   totalPages: 3
// }
```

### 3. Busca Individual
```typescript
const user = await userRepo.findById(1);

const userByEmail = await userRepo.findOne({
    filters: { email: 'admin@dominio.com' }
});
```

### 4. Inserção e Upsert (PostgreSQL `ON CONFLICT`)
```typescript
// Inserção simples (usa RETURNING *)
const newUser = await userRepo.insert({
    name: 'Carlos',
    email: 'carlos@dominio.com'
});

// Upsert nativo (se existir conflito na PK ou coluna especificada, faz UPDATE)
const user = await userRepo.upsert(
    {
        id: 1,
        name: 'Carlos Silva',
        email: 'carlos@dominio.com'
    },
    {
        conflictTarget: ['id'],          // Alvo do ON CONFLICT (padrão: PK da tabela)
        updateFields: ['name']           // Campos a serem atualizados se houver conflito
    }
);
```

### 5. Atualização e Deleção
```typescript
// Atualizar registros
const updatedUsers = await userRepo.update(
    { id: 1 },
    { name: 'Novo Nome' }
);

// Deletar registros (retorna a quantidade de linhas afetadas)
const affectedCount = await userRepo.delete({ id: 1 });

// Deletar e retornar os registros deletados (via RETURNING *)
const deletedUsers = await userRepo.deleteAndReturn({ id: 1 });
```

---

## 🔒 Transações

As transações gerenciam automaticamente `BEGIN`, `COMMIT` e `ROLLBACK`. O contexto transacional fornece repositórios já vinculados à conexão da transação:

```typescript
import { database } from 'lite-orm';

await database.transaction(async (client, tx) => {
    // Repositórios criados a partir de 'tx' executam na transação ativa:
    const userRepo = tx.getRepository(User);
    const profileRepo = tx.getRepository(Profile);

    const newUser = await userRepo.insert({
        name: 'Maria',
        email: 'maria@dominio.com'
    });

    await profileRepo.insert({
        userId: newUser.id,
        bio: 'Desenvolvedora Backend'
    });

    // Se qualquer exceção for disparada, o ROLLBACK é automático!
});
```

---

## 🔍 Operadores de Filtro Suportados

| Operador | Descrição | Exemplo SQL Gerado |
| :--- | :--- | :--- |
| `$eq` | Igual | `col = $1` ou `col IS NULL` |
| `$ne` | Diferente | `col <> $1` ou `col IS NOT NULL` |
| `$gt` / `$gte` | Maior / Maior ou igual | `col > $1` / `col >= $1` |
| `$lt` / `$lte` | Menor / Menor ou igual | `col < $1` / `col <= $1` |
| `$between` | Intervalo fechado | `col BETWEEN $1 AND $2` |
| `$like` | LIKE clássico | `col LIKE $1` |
| `$ilike` | ILIKE (case-insensitive do Postgres) | `col ILIKE $1` |
| `$in` / `$notIn` | Contido / Não contido em lista | `col IN ($1, $2)` |
| `$any` | Contenção de arrays/jsonb (`@>`) | `col @> $1` |
| `$tsquery` | Full Text Search com `plainto_tsquery` | `col @@ plainto_tsquery('portuguese', $1)` |
| `$or` / `$and` | Agrupamento lógico | `(cond1 OR cond2)` |

---

## 📄 Licença

MIT
