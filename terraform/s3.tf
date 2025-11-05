# Input bucket for video uploads
resource "aws_s3_bucket" "video_uploads" {
  bucket = "${var.input_bucket_name}-${var.environment}-${random_id.bucket_suffix.hex}"
}

resource "aws_s3_bucket_notification" "video_uploads_notification" {
  bucket = aws_s3_bucket.video_uploads.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.on_upload_handler.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = ""
    filter_suffix       = ".mp4"
  }

  depends_on = [aws_lambda_permission.s3_trigger_on_upload]
}

# Output bucket for subtitles
resource "aws_s3_bucket" "video_subtitles" {
  bucket = "${var.output_bucket_name}-${var.environment}-${random_id.bucket_suffix.hex}"
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# Enable versioning for both buckets
resource "aws_s3_bucket_versioning" "video_uploads_versioning" {
  bucket = aws_s3_bucket.video_uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_versioning" "video_subtitles_versioning" {
  bucket = aws_s3_bucket.video_subtitles.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Public access block for security
resource "aws_s3_bucket_public_access_block" "video_uploads_block" {
  bucket = aws_s3_bucket.video_uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "video_subtitles_block" {
  bucket = aws_s3_bucket.video_subtitles.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Bucket policy to allow Transcribe service to read from input bucket
resource "aws_s3_bucket_policy" "video_uploads_transcribe_access" {
  bucket = aws_s3_bucket.video_uploads.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowTranscribeServiceRead"
        Effect = "Allow"
        Principal = {
          Service = "transcribe.amazonaws.com"
        }
        Action = [
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.video_uploads.arn}/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# Bucket policy to allow Transcribe service to write to output bucket
resource "aws_s3_bucket_policy" "video_subtitles_transcribe_access" {
  bucket = aws_s3_bucket.video_subtitles.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowTranscribeServiceWrite"
        Effect = "Allow"
        Principal = {
          Service = "transcribe.amazonaws.com"
        }
        Action = [
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.video_subtitles.arn}/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

