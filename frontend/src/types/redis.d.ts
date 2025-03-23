declare module "redis" {
  export interface RedisClientOptions {
    url?: string;
  }

  export function createClient(options?: RedisClientOptions): any;
}
