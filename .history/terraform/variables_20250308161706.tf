# Variables for Documind terraform configuration

variable "aws_region" {
  description = "The AWS region to deploy to"
  default     = "us-east-1"
}

variable "env_name" {
  description = "Environment name (e.g., prod, staging)"
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones to use"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "admin_cidr_blocks" {
  description = "CIDR blocks that can access admin services"
  type        = list(string)
  default     = ["0.0.0.0/0"]  # Should be restricted in production
}

variable "domain_name" {
  description = "Domain name for the application"
  default     = "documind.example.com"
}

# ECS Variables
variable "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  default     = "documind-cluster"
}

variable "app_image_tag" {
  description = "Docker image tag for the application"
  default     = "latest"
}

variable "ecr_repository_url" {
  description = "ECR repository URL for the application image"
}

variable "app_count" {
  description = "Number of application containers to run"
  default     = 3
}

variable "cpu_units" {
  description = "CPU units for the task definition"
  default     = 1024
}

variable "memory" {
  description = "Memory for the task definition in MB"
  default     = 2048
}

# Database Variables
variable "db_name" {
  description = "Name of the database"
  default     = "documind"
}

variable "db_username" {
  description = "Username for the database"
  default     = "documind"
}

variable "db_password" {
  description = "Password for the database"
  sensitive   = true
}

variable "db_instance_class" {
  description = "Instance class for the RDS instance"
  default     = "db.t3.medium"
}

variable "db_allocated_storage" {
  description = "Allocated storage for the RDS instance in GB"
  default     = 20
}

variable "db_multi_az" {
  description = "Whether to deploy RDS in multi-AZ mode"
  type        = bool
  default     = true
}

# Elasticache Variables
variable "cache_node_type" {
  description = "Node type for Elasticache"
  default     = "cache.t3.small"
}

variable "num_cache_nodes" {
  description = "Number of cache nodes"
  default     = 2
}

# S3 Variables
variable "backup_bucket_name" {
  description = "Name of the S3 bucket for backups"
  default     = "documind-backups"
}

variable "upload_bucket_name" {
  description = "Name of the S3 bucket for uploads"
  default     = "documind-uploads"
}

# Monitoring Variables
variable "alarm_email" {
  description = "Email address for CloudWatch alarms"
  default     = "alerts@documind.example.com"
}
