// A local S3 server for CI (and any machine without MinIO): s3rver on 127.0.0.1:9000 with the
// `recdms-files` bucket and the CORS rules browser uploads (presigned PUT) and the viewer (GET) need.
// Credentials are s3rver's fixed S3RVER / S3RVER. Usage: node scripts/s3-local.mjs [port]
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import S3rver from "s3rver";

const port = Number(process.argv[2] ?? process.env.S3_LOCAL_PORT ?? 9000);
const cors = `<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

const directory = await mkdtemp(path.join(os.tmpdir(), "recdms-s3-"));
const server = new S3rver({
  address: "127.0.0.1",
  port,
  silent: true,
  directory,
  vhostBuckets: false,
  configureBuckets: [{ name: "recdms-files", configs: [cors] }],
});
await server.run();
console.log(`s3rver listening on http://127.0.0.1:${port} (bucket recdms-files)`);
