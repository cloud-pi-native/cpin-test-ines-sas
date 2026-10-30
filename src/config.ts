export interface StorageConfig {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function storageConfig(prefix: 'SENDER' | 'RECEIVER'): StorageConfig {
  return {
    endpoint: process.env[`${prefix}_S3_ENDPOINT`] || undefined,
    region: process.env[`${prefix}_S3_REGION`] || 'garage',
    bucket: required(`${prefix}_S3_BUCKET`),
    forcePathStyle: process.env[`${prefix}_S3_FORCE_PATH_STYLE`] !== 'false',
    accessKeyId: required(`${prefix}_S3_ACCESS_KEY`),
    secretAccessKey: required(`${prefix}_S3_SECRET_KEY`),
  };
}

export const config = {
  port: Number(process.env.PORT || 3000),
  appPassword: required('APP_PASSWORD'),
  sessionSecret: required('SESSION_SECRET'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024,
  sender: storageConfig('SENDER'),
  receiver: storageConfig('RECEIVER'),
  ines: {
    baseUrl: required('INES_BASE_URL').replace(/\/+$/, ''),
    accountName: required('INES_ACCOUNT_NAME'),
    site: required('INES_SITE'),
    destinationDirectory: process.env.INES_DESTINATION_DIRECTORY || '/',
    idpId: required('INES_IDP_ID'),
    csrfToken: required('INES_TOKEN'),
  },
};
