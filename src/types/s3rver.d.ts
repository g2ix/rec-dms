declare module "s3rver" {
  type S3rverOptions = {
    address?: string;
    port?: number;
    silent?: boolean;
    directory?: string;
    resetOnClose?: boolean;
    vhostBuckets?: boolean;
    configureBuckets?: { name: string }[];
  };

  export default class S3rver {
    constructor(options?: S3rverOptions);
    run(): Promise<{ port: number; address: string }>;
    close(): Promise<void>;
  }
}
