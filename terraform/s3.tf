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

# Set bucket ownership controls to allow ACLs and ensure proper access
resource "aws_s3_bucket_ownership_controls" "video_uploads_ownership" {
  bucket = aws_s3_bucket.video_uploads.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_ownership_controls" "video_subtitles_ownership" {
  bucket = aws_s3_bucket.video_subtitles.id

  rule {
    object_ownership = "BucketOwnerEnforced"
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

# Bucket policy to allow Transcribe service and all Lambda roles to access input bucket
resource "aws_s3_bucket_policy" "video_uploads_transcribe_access" {
  bucket = aws_s3_bucket.video_uploads.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowTranscribeServiceListBucket"
        Effect = "Allow"
        Principal = {
          Service = "transcribe.amazonaws.com"
        }
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.video_uploads.arn
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "AllowTranscribeServiceGetObject"
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
      },
      {
        Sid    = "AllowAllLambdaRolesListBucket"
        Effect = "Allow"
        Principal = {
          AWS = [
            aws_iam_role.on_upload_handler_role.arn,
            aws_iam_role.split_video_role.arn,
            aws_iam_role.start_transcribe_role.arn,
            aws_iam_role.store_subtitles_role.arn,
            aws_iam_role.monitor_transcribe_role.arn
          ]
        }
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.video_uploads.arn
      },
      {
        Sid    = "AllowAllLambdaRolesObjectAccess"
        Effect = "Allow"
        Principal = {
          AWS = [
            aws_iam_role.on_upload_handler_role.arn,
            aws_iam_role.split_video_role.arn,
            aws_iam_role.start_transcribe_role.arn,
            aws_iam_role.store_subtitles_role.arn,
            aws_iam_role.monitor_transcribe_role.arn
          ]
        }
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.video_uploads.arn}/*"
      }
    ]
  })
}

# Bucket policy to allow Transcribe service and all Lambda roles to access output bucket
resource "aws_s3_bucket_policy" "video_subtitles_transcribe_access" {
  bucket = aws_s3_bucket.video_subtitles.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowTranscribeServiceListBucket"
        Effect = "Allow"
        Principal = {
          Service = "transcribe.amazonaws.com"
        }
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.video_subtitles.arn
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "AllowTranscribeServiceObjectAccess"
        Effect = "Allow"
        Principal = {
          Service = "transcribe.amazonaws.com"
        }
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.video_subtitles.arn}/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "AllowAllLambdaRolesListBucket"
        Effect = "Allow"
        Principal = {
          AWS = [
            aws_iam_role.on_upload_handler_role.arn,
            aws_iam_role.split_video_role.arn,
            aws_iam_role.start_transcribe_role.arn,
            aws_iam_role.store_subtitles_role.arn,
            aws_iam_role.monitor_transcribe_role.arn
          ]
        }
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.video_subtitles.arn
      },
      {
        Sid    = "AllowAllLambdaRolesObjectAccess"
        Effect = "Allow"
        Principal = {
          AWS = [
            aws_iam_role.on_upload_handler_role.arn,
            aws_iam_role.split_video_role.arn,
            aws_iam_role.start_transcribe_role.arn,
            aws_iam_role.store_subtitles_role.arn,
            aws_iam_role.monitor_transcribe_role.arn
          ]
        }
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.video_subtitles.arn}/*"
      }
    ]
  })
}

