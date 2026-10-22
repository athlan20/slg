// 赛季换季测试的临时库（AISLG-134）：在 TEST_DATABASE_URL 所指的临时集群上新建一个独立数据库，
// 每个测试文件各用各的库，互不干扰（node --test 会并行跑各文件）；用完删除。别指向开发库。
import pg from 'pg';

export interface TempDatabase {
  url: string;
  drop: () => Promise<void>;
}

/** 在 baseUrl 所指的服务器上新建数据库 slg_t_<label>_<随机>，返回其连接串与删除函数 */
export async function createTempDatabase(baseUrl: string, label: string): Promise<TempDatabase> {
  const name = `slg_t_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const client = new pg.Client({ connectionString: baseUrl });
      await client.connect();
      try {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await client.end();
      }
    },
  };
}
