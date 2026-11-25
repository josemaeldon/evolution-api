import { ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export class Query<T> {
  where?: T;
  sort?: 'asc' | 'desc';
  page?: number;
  offset?: number;
}

export class PrismaRepository extends PrismaClient {
  constructor(private readonly configService: ConfigService) {
    const database = configService.get('DATABASE');
    const connectionString =
      process.env.DATABASE_PROVIDER === 'psql_bouncer' ? database.CONNECTION.BOUNCER_URI : database.CONNECTION.URI;
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  private readonly logger = new Logger('PrismaRepository');

  public async onModuleInit() {
    await this.$connect();
    this.logger.info('Repository:Prisma - ON');
  }

  public async onModuleDestroy() {
    await this.$disconnect();
    this.logger.warn('Repository:Prisma - OFF');
  }
}
