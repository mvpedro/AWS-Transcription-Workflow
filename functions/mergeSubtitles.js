import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client();

const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET;

/**
 * Download subtitle file from S3
 */
async function downloadSubtitle(bucket, key) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3.send(command);
  const bodyContents = await streamToString(response.Body);
  return bodyContents;
}

/**
 * Convert stream to string
 */
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Upload subtitle to final location
 */
async function uploadSubtitle(bucket, key, content, contentType = "text/srt") {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: contentType,
  });

  await s3.send(command);
}

/**
 * Parse SRT timestamp to milliseconds
 */
function parseSRTTime(timeStr) {
  const [hours, minutes, seconds, ms] = timeStr.split(/[:,]/).map(Number);
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
}

/**
 * Format milliseconds to SRT timestamp
 */
function formatSRTTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

/**
 * Parse SRT content and extract subtitle entries
 */
function parseSRT(content) {
  const entries = [];
  const blocks = content.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;

    const index = parseInt(lines[0]);
    const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timeMatch) continue;

    const startTime = parseSRTTime(timeMatch[1]);
    const endTime = parseSRTTime(timeMatch[2]);
    const text = lines.slice(2).join("\n");

    entries.push({
      index,
      startTime,
      endTime,
      text,
    });
  }

  return entries;
}

/**
 * Merge multiple subtitle files with proper timestamp adjustment
 */
function mergeSubtitles(subtitleContents) {
  const allEntries = [];
  let timeOffset = 0;
  let currentIndex = 1;

  subtitleContents.forEach((content, chunkIndex) => {
    const entries = parseSRT(content);
    let chunkMaxTime = 0;

    entries.forEach((entry) => {
      // Adjust timestamps by adding the offset
      const adjustedStart = entry.startTime + timeOffset;
      const adjustedEnd = entry.endTime + timeOffset;
      chunkMaxTime = Math.max(chunkMaxTime, adjustedEnd);

      allEntries.push({
        index: currentIndex++,
        startTime: adjustedStart,
        endTime: adjustedEnd,
        text: entry.text,
      });
    });

    // Update offset for next chunk (add a small gap between chunks)
    timeOffset = chunkMaxTime + 100; // 100ms gap between chunks
  });

  // Generate merged SRT content
  let mergedSRT = "";
  allEntries.forEach((entry) => {
    mergedSRT += `${entry.index}\n`;
    mergedSRT += `${formatSRTTime(entry.startTime)} --> ${formatSRTTime(entry.endTime)}\n`;
    mergedSRT += `${entry.text}\n\n`;
  });

  return mergedSRT;
}

/**
 * List all chunk subtitle files for a video
 */
async function listChunkSubtitles(bucket, baseFileName, totalChunks) {
  const subtitleKeys = [];
  
  for (let i = 1; i <= totalChunks; i++) {
    const chunkIndex = String(i).padStart(3, "0");
    const chunkPath = `${baseFileName}/chunk_${chunkIndex}/english.srt`;
    
    try {
      // Check if file exists by trying to list it
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: chunkPath,
        MaxKeys: 1,
      });
      
      const response = await s3.send(command);
      if (response.Contents && response.Contents.length > 0) {
        subtitleKeys.push(chunkPath);
      }
    } catch (error) {
      console.warn(`Could not find subtitle file at ${chunkPath}:`, error.message);
    }
  }
  
  return subtitleKeys;
}

export const handler = async (event) => {
  console.log("mergeSubtitles event:", JSON.stringify(event, null, 2));

  try {
    const { originalKey, totalChunks } = event;

    if (!originalKey) {
      throw new Error("Missing required field: originalKey");
    }

    if (!totalChunks || totalChunks <= 1) {
      return {
        message: "No merging needed - single file or no chunks specified",
        totalChunks,
      };
    }

    // Get the base filename without extension
    const baseFileName = originalKey.replace(/\.mp4$/, "").replace(/^.*\//, "");

    console.log(`Merging subtitles for ${baseFileName}, ${totalChunks} chunks`);

    // List all chunk subtitle files
    const chunkSubtitleKeys = await listChunkSubtitles(OUTPUT_BUCKET, baseFileName, totalChunks);

    if (chunkSubtitleKeys.length === 0) {
      throw new Error(`No chunk subtitle files found for ${baseFileName}`);
    }

    if (chunkSubtitleKeys.length !== totalChunks) {
      console.warn(`Expected ${totalChunks} chunk files, found ${chunkSubtitleKeys.length}`);
    }

    // Download all chunk subtitle files
    console.log(`Downloading ${chunkSubtitleKeys.length} subtitle chunks...`);
    const subtitleContents = await Promise.all(
      chunkSubtitleKeys.map(async (key) => {
        console.log(`Downloading ${key}`);
        return await downloadSubtitle(OUTPUT_BUCKET, key);
      })
    );

    // Merge all subtitles
    console.log("Merging subtitle contents...");
    const mergedContent = mergeSubtitles(subtitleContents);

    // Upload merged subtitle to final location
    const finalKey = `${baseFileName}/english.srt`;
    await uploadSubtitle(OUTPUT_BUCKET, finalKey, mergedContent);

    console.log(`Merged subtitle stored at ${OUTPUT_BUCKET}/${finalKey}`);

    return {
      message: "Subtitles merged successfully",
      location: `${OUTPUT_BUCKET}/${finalKey}`,
      chunksMerged: chunkSubtitleKeys.length,
      totalChunks,
    };
  } catch (error) {
    console.error("Error in mergeSubtitles:", error);
    throw error;
  }
};

