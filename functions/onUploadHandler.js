import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const s3 = new S3Client();
const lambda = new LambdaClient();

const INPUT_BUCKET = process.env.INPUT_BUCKET;
const MAX_FILE_SIZE_MB = parseFloat(process.env.MAX_FILE_SIZE_MB || "100");
const SPLIT_VIDEO_FUNCTION = process.env.SPLIT_VIDEO_FUNCTION;
const START_TRANSCRIBE_FUNCTION = process.env.START_TRANSCRIBE_FUNCTION;

/**
 * Extract S3 bucket and key from Lambda event
 */
function extractS3Info(event) {
  const record = event.Records?.[0];
  if (!record) {
    throw new Error("No S3 record found in event");
  }

  return {
    bucket: record.s3.bucket.name,
    key: decodeURIComponent(record.s3.object.key.replace(/\+/g, " ")),
  };
}

/**
 * Invoke another Lambda function
 */
async function invokeLambda(functionName, payload) {
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify(payload),
  });

  const response = await lambda.send(command);
  if (response.FunctionError) {
    // Try to extract error details from the payload
    let errorDetails = response.FunctionError;
    try {
      const payloadText = new TextDecoder().decode(response.Payload);
      const errorPayload = JSON.parse(payloadText);
      if (errorPayload.errorMessage) {
        errorDetails = `${response.FunctionError}: ${errorPayload.errorMessage}`;
        if (errorPayload.stack) {
          errorDetails += `\nStack: ${errorPayload.stack}`;
        }
      }
    } catch (e) {
      // If we can't parse the error payload, use the FunctionError as is
      const payloadText = new TextDecoder().decode(response.Payload);
      errorDetails = `${response.FunctionError}: ${payloadText.substring(0, 500)}`;
    }
    throw new Error(`Lambda invocation failed: ${errorDetails}`);
  }

  return JSON.parse(new TextDecoder().decode(response.Payload));
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

    const payload = {
      bucket,
      key,
      originalKey: key,
    };

    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      console.log(`File exceeds ${MAX_FILE_SIZE_MB} MB, splitting...`);
      await invokeLambda(SPLIT_VIDEO_FUNCTION, payload);
    } else {
      console.log(`File is within limit, starting transcription...`);
      await invokeLambda(START_TRANSCRIBE_FUNCTION, payload);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Processing started",
        bucket,
        key,
        fileSizeMB: fileSizeMB.toFixed(2),
        action: fileSizeMB > MAX_FILE_SIZE_MB ? "split" : "transcribe",
      }),
    };
  } catch (error) {
    console.error("Error in onUploadHandler:", error);
    throw error;
  }
};

