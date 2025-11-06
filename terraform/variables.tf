variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "input_bucket_name" {
  description = "Name of the S3 bucket for video uploads"
  type        = string
  default     = "video-uploads"
}

variable "output_bucket_name" {
  description = "Name of the S3 bucket for subtitle storage"
  type        = string
  default     = "video-subtitles"
}

variable "lambda_runtime" {
  description = "Lambda runtime version"
  type        = string
  default     = "nodejs20.x"
}

variable "lambda_timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 900 # 15 minutes
}

variable "lambda_memory_size" {
  description = "Lambda function memory size in MB"
  type        = number
  default     = 1024
}

variable "max_file_size_mb" {
  description = "Maximum file size in MB before splitting is required"
  type        = number
  default     = 100
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "ffmpeg_layer_arn" {
  description = "ARN of the Lambda Layer containing ffmpeg. Leave empty to use a public layer or set a custom ARN."
  type        = string
  default     = ""
}

