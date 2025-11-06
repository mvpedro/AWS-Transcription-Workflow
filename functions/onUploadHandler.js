import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client();

const MAX_FILE_SIZE_MB = parseFloat(process.env.MAX_FILE_SIZE_MB || "100");

/**
 * Extract S3 bucket and key from Lambda event
 * Supports both S3 event format and Step Functions input format
 */
function extractS3Info(event) {
  // Step Functions may pass the event directly with Records
  if (event.Records?.[0]) {
    const record = event.Records[0];
    return {
      bucket: record.s3.bucket.name,
      key: decodeURIComponent(record.s3.object.key.replace(/\+/g, " ")),
    };
  }
  
  // Or it may be passed as direct properties
  if (event.bucket && event.key) {
    return {
      bucket: event.bucket,
      key: event.key,
    };
  }

  throw new Error("No S3 record found in event");
}

export const handler = async (event) => {
  console.log("onUploadHandler event:", JSON.stringify(event, null, 2));

  try {
    const { bucket, key } = extractS3Info(event);

    // Check file size
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const headResponse = await s3.send(headCommand);
    const fileSizeMB = headResponse.ContentLength / (1024 * 1024);

    console.log(`File ${key} is ${fileSizeMB.toFixed(2)} MB`);

    // Return the result for Step Functions to use
    // Step Functions will use this to decide the next step
    // Return object directly for Step Functions compatibility
    const result = {
      message: "File size checked",
      bucket,
      key,
      originalKey: key,
      fileSizeMB: parseFloat(fileSizeMB.toFixed(2)),
      action: fileSizeMB > MAX_FILE_SIZE_MB ? "split" : "transcribe",
    };
    
    // Return directly for Step Functions, or wrap for API Gateway
    return result;
  } catch (error) {
    console.error("Error in onUploadHandler:", error);
    throw error;
  }
};

