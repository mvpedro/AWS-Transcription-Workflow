# Lambda function: onUploadHandler
resource "aws_lambda_function" "on_upload_handler" {
  filename         = "../functions.zip"
  function_name    = "on-upload-handler-${var.environment}"
  role            = aws_iam_role.on_upload_handler_role.arn
  handler         = "onUploadHandler.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = var.lambda_memory_size
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      INPUT_BUCKET     = aws_s3_bucket.video_uploads.id
      OUTPUT_BUCKET    = aws_s3_bucket.video_subtitles.id
      MAX_FILE_SIZE_MB = var.max_file_size_mb
      SPLIT_VIDEO_FUNCTION = aws_lambda_function.split_video.function_name
      START_TRANSCRIBE_FUNCTION = aws_lambda_function.start_transcribe.function_name
    }
  }
}

resource "aws_lambda_permission" "s3_trigger_on_upload" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.on_upload_handler.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.video_uploads.arn
}

# Lambda function: splitVideo
resource "aws_lambda_function" "split_video" {
  filename         = "../functions.zip"
  function_name    = "split-video-${var.environment}"
  role            = aws_iam_role.split_video_role.arn
  handler         = "splitVideo.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = 2048 # More memory for video processing
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      INPUT_BUCKET     = aws_s3_bucket.video_uploads.id
      OUTPUT_BUCKET    = aws_s3_bucket.video_subtitles.id
      START_TRANSCRIBE_FUNCTION = aws_lambda_function.start_transcribe.function_name
    }
  }

  # Note: You'll need to add a Lambda Layer with ffmpeg
  # layers = [aws_lambda_layer_version.ffmpeg_layer.arn]
}

# Lambda function: startTranscribe
resource "aws_lambda_function" "start_transcribe" {
  filename         = "../functions.zip"
  function_name    = "start-transcribe-${var.environment}"
  role            = aws_iam_role.start_transcribe_role.arn
  handler         = "startTranscribe.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = var.lambda_memory_size
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      INPUT_BUCKET     = aws_s3_bucket.video_uploads.id
      OUTPUT_BUCKET    = aws_s3_bucket.video_subtitles.id
      MONITOR_TRANSCRIBE_FUNCTION = aws_lambda_function.monitor_transcribe.function_name
      JOBS_TABLE = aws_dynamodb_table.transcription_jobs.name
    }
  }
}

# Lambda function: monitorTranscribe
resource "aws_lambda_function" "monitor_transcribe" {
  filename         = "../functions.zip"
  function_name    = "monitor-transcribe-${var.environment}"
  role            = aws_iam_role.monitor_transcribe_role.arn
  handler         = "monitorTranscribe.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = var.lambda_memory_size
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      OUTPUT_BUCKET    = aws_s3_bucket.video_subtitles.id
      STORE_SUBTITLES_FUNCTION = aws_lambda_function.store_subtitles.function_name
      JOBS_TABLE = aws_dynamodb_table.transcription_jobs.name
    }
  }
}

# Lambda function: storeSubtitles
resource "aws_lambda_function" "store_subtitles" {
  filename         = "../functions.zip"
  function_name    = "store-subtitles-${var.environment}"
  role            = aws_iam_role.store_subtitles_role.arn
  handler         = "storeSubtitles.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = var.lambda_memory_size
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      OUTPUT_BUCKET = aws_s3_bucket.video_subtitles.id
      JOBS_TABLE = aws_dynamodb_table.transcription_jobs.name
    }
  }
}

# Archive Lambda functions
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "../functions"
  output_path = "../functions.zip"
  depends_on  = [null_resource.build_functions]
}

# Build functions before creating zip
resource "null_resource" "build_functions" {
  triggers = {
    always_run = timestamp()
  }

  provisioner "local-exec" {
    command = "cd .. && npm run build"
  }
}

# Allow Lambda functions to invoke each other
resource "aws_lambda_permission" "allow_split_video_invoke" {
  statement_id  = "AllowInvokeFromOnUpload"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.split_video.function_name
  principal     = "lambda.amazonaws.com"
  source_arn    = aws_lambda_function.on_upload_handler.arn
}

resource "aws_lambda_permission" "allow_start_transcribe_from_on_upload" {
  statement_id  = "AllowInvokeFromOnUpload"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.start_transcribe.function_name
  principal     = "lambda.amazonaws.com"
  source_arn    = aws_lambda_function.on_upload_handler.arn
}

resource "aws_lambda_permission" "allow_start_transcribe_from_split" {
  statement_id  = "AllowInvokeFromSplitVideo"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.start_transcribe.function_name
  principal     = "lambda.amazonaws.com"
  source_arn    = aws_lambda_function.split_video.arn
}

resource "aws_lambda_permission" "allow_store_subtitles_invoke" {
  statement_id  = "AllowInvokeFromMonitor"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.store_subtitles.function_name
  principal     = "lambda.amazonaws.com"
  source_arn    = aws_lambda_function.monitor_transcribe.arn
}

