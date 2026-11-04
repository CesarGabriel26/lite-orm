import dotenv from 'dotenv';
import { Pool, PoolConfig } from 'pg';
import { PgDatabase } from './driver/pg.driver';

dotenv.config();

let activePool: Pool | null = null;
let activeDatabase: PgDatabase | null = null;

export function resolvePoolConfig(customConfig?: PoolConfig | string): PoolConfig {
    if (customConfig) {
        if (typeof customConfig === 'string') {
            return { connectionString: customConfig };
        }
        return customConfig;
    }

    // 1. Prioridade: Variáveis de ambiente padrão soltas (PGUSER, PGHOST, etc.)
    const hasLooseEnv = Boolean(
        process.env.PGHOST ||
        process.env.PGUSER ||
        process.env.POSTGRES_HOST ||
        process.env.POSTGRES_USER
    );

    if (hasLooseEnv) {
        return {
            host: process.env.PGHOST ?? process.env.POSTGRES_HOST ?? 'localhost',
            port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
            user: process.env.PGUSER ?? process.env.POSTGRES_USER ?? 'postgres',
            password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? '',
            database: process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? process.env.POSTGRES_DATABASE ?? 'postgres',
            ssl: process.env.PGSSLMODE === 'require' || process.env.PGSSL === 'true'
                ? { rejectUnauthorized: false }
                : undefined,
        };
    }

    // 2. Se não encontrou variáveis soltas, dá preferência à URL de conexão
    const connectionUrl = process.env.DATABASE_URL ?? process.env.PG_DATABASE_URL ?? process.env.POSTGRES_URL;
    if (connectionUrl) {
        return {
            connectionString: connectionUrl,
        };
    }

    // 3. Fallback padrão local
    return {
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: '',
        database: 'postgres',
    };
}

export function initDatabase(config?: PoolConfig | string): PgDatabase {
    if (activePool) {
        activePool.end().catch((err) => {
            console.error('Erro ao encerrar pool PostgreSQL anterior:', err.message);
        });
    }

    const poolConfig = resolvePoolConfig(config);
    activePool = new Pool(poolConfig);

    activePool.on('error', (error) => {
        console.error('Erro inesperado no pool do PostgreSQL:', error.message);
    });

    activeDatabase = new PgDatabase(activePool);
    return activeDatabase;
}

export function getPool(): Pool {
    if (!activePool) {
        initDatabase();
    }
    return activePool!;
}

export function getDatabase(): PgDatabase {
    if (!activeDatabase) {
        initDatabase();
    }
    return activeDatabase!;
}

export async function closeDatabase(): Promise<void> {
    if (activePool) {
        await activePool.end();
        activePool = null;
        activeDatabase = null;
    }
}

// Proxies para manter compatibilidade e inicialização sob demanda transparente
export const pool: Pool = new Proxy({} as Pool, {
    get(_target, prop) {
        const instance = getPool();
        const value = (instance as any)[prop];
        return typeof value === 'function' ? value.bind(instance) : value;
    }
});

export const database: PgDatabase = new Proxy({} as PgDatabase, {
    get(_target, prop) {
        const instance = getDatabase();
        const value = (instance as any)[prop];
        return typeof value === 'function' ? value.bind(instance) : value;
    }
});

export async function checkConnection(): Promise<string> {
    try {
        await getPool().query('SELECT 1;');
        return 'Conexão válida e ativa.';
    } catch (err: any) {
        return `Falha na conexão: ${err.message}`;
    }
}

export async function checkDatabaseHealth() {
    const startedAt = Date.now();

    try {
        await getPool().query('SELECT NOW() AS now;');

        return {
            status: 'up',
            connected: true,
            message: 'Banco conectado e respondendo',
            responseTimeMs: Date.now() - startedAt,
        };
    } catch (error: any) {
        return {
            status: 'down',
            connected: false,
            message: 'Banco indisponível ou sem conexão',
            error: error?.message ?? 'Erro desconhecido ao consultar o banco',
            responseTimeMs: Date.now() - startedAt,
        };
    }
}
