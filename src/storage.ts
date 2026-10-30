import type { Readable } from 'node:stream';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { config, type StorageConfig } from './config.js';

export interface StoredFile {
  key: string;
  size: number;
  lastModified: string | null;
}

export interface FileContent {
  stream: Readable;
  contentType: string | undefined;
  contentLength: number | undefined;
}

export class Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(conf: StorageConfig) {
    this.bucket = conf.bucket;
    this.client = new S3Client({
      endpoint: conf.endpoint,
      region: conf.region,
      forcePathStyle: conf.forcePathStyle,
      credentials: { accessKeyId: conf.accessKeyId, secretAccessKey: conf.secretAccessKey },
      // The SDK builds its own agents, which ignore --use-env-proxy: hand them HTTP(S)_PROXY / NO_PROXY.
      requestHandler: {
        httpAgent: { proxyEnv: process.env },
        httpsAgent: { proxyEnv: process.env },
      },
    });
  }

  async list(): Promise<StoredFile[]> {
    const files: StoredFile[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        files.push({
          key: object.Key,
          size: object.Size ?? 0,
          lastModified: object.LastModified?.toISOString() ?? null,
        });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return files;
  }

  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: content, ContentType: contentType }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return false;
      throw err;
    }
  }

  async read(key: string): Promise<FileContent> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }
}

export const senderStorage = new Storage(config.sender);
export const receiverStorage = new Storage(config.receiver);
