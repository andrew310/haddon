import { handleRequest, route, type Router } from "@better-upload/server";
import { minio } from "@better-upload/server/clients";

function slugifyFilename(filename: string) {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export const uploadBucketName = process.env.S3_BUCKET ?? "haddon-books";

export const uploadRouter: Router = {
  client: minio({
    endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9002",
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
  }),
  bucketName: uploadBucketName,
  routes: {
    book: route({
      multipleFiles: true,
      maxFiles: 1,
      fileTypes: ["application/epub+zip"],
      maxFileSize: 1024 * 1024 * 100,
      onBeforeUpload: async () => {
        return {
          generateObjectInfo: async ({ file }) => {
            const safeName = slugifyFilename(file.name || "book.epub");
            return {
              key: `books/${crypto.randomUUID()}/${safeName}`,
            };
          },
        };
      },
    }),
  },
};

export function handleUploadRequest(request: Request) {
  return handleRequest(request, uploadRouter);
}
