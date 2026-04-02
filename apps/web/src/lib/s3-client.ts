import { S3Client } from "@aws-sdk/client-s3";

const region = process.env.S3_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const endpoint = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9002";
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "minioadmin";
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin";

export const s3Client = new S3Client({
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  region,
});
