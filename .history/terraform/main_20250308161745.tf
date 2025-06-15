# Terraform configuration for Documind production deployment

provider "aws" {
  region = var.aws_region
}

module "vpc" {
  source = "./modules/vpc"
  
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  env_name             = var.env_name
}

module "security_groups" {
  source = "./modules/security"
  
  vpc_id               = module.vpc.vpc_id
  admin_cidr_blocks    = var.admin_cidr_blocks
  env_name             = var.env_name
}

module "ecs" {
  source = "./modules/ecs"
  
  vpc_id               = module.vpc.vpc_id
  private_subnet_ids   = module.vpc.private_subnet_ids
  app_sg_id            = module.security_groups.app_sg_id
  db_sg_id             = module.security_groups.db_sg_id
  lb_sg_id             = module.security_groups.lb_sg_id
  env_name             = var.env_name
  ecs_cluster_name     = var.ecs_cluster_name
  app_image            = "${var.ecr_repository_url}:${var.app_image_tag}"
  app_count            = var.app_count
  cpu_units            = var.cpu_units
  memory               = var.memory
  domain_name          = var.domain_name
}

module "rds" {
  source = "./modules/rds"
  
  vpc_id               = module.vpc.vpc_id
  private_subnet_ids   = module.vpc.private_subnet_ids
  db_sg_id             = module.security_groups.db_sg_id
  env_name             = var.env_name
  db_name              = var.db_name
  db_username          = var.db_username
  db_password          = var.db_password
  instance_class       = var.db_instance_class
  allocated_storage    = var.db_allocated_storage
  multi_az             = var.db_multi_az
}

module "elasticache" {
  source = "./modules/elasticache"
  
  vpc_id               = module.vpc.vpc_id
  private_subnet_ids   = module.vpc.private_subnet_ids
  cache_sg_id          = module.security_groups.cache_sg_id
  env_name             = var.env_name
  node_type            = var.cache_node_type
  num_cache_nodes      = var.num_cache_nodes
}

module "s3" {
  source = "./modules/s3"
  
  env_name             = var.env_name
  backup_bucket_name   = var.backup_bucket_name
  upload_bucket_name   = var.upload_bucket_name
}

module "cloudwatch" {
  source = "./modules/monitoring"
  
  env_name             = var.env_name
  app_name             = "documind"
  cluster_name         = var.ecs_cluster_name
  alarm_email          = var.alarm_email
}

module "backup" {
  source = "./modules/backup"
  
  env_name             = var.env_name
  db_identifier        = module.rds.db_identifier
  backup_bucket_arn    = module.s3.backup_bucket_arn
}

module "iam" {
  source = "./modules/iam"
  
  env_name             = var.env_name
  backup_bucket_arn    = module.s3.backup_bucket_arn
  upload_bucket_arn    = module.s3.upload_bucket_arn
}

module "dns" {
  source = "./modules/dns"
  
  domain_name          = var.domain_name
  lb_dns_name          = module.ecs.alb_dns_name
  lb_zone_id           = module.ecs.alb_zone_id
}

module "cdn" {
  source = "./modules/cdn"
  
  domain_name          = var.domain_name
  env_name             = var.env_name
  upload_bucket_name   = module.s3.upload_bucket_id
  upload_bucket_domain = module.s3.upload_bucket_domain
  
  depends_on = [module.dns]
}

# Outputs
output "app_url" {
  value = "https://${var.domain_name}"
}

output "db_endpoint" {
  value = module.rds.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value = module.elasticache.endpoint
  sensitive = true
}

output "backup_bucket" {
  value = module.s3.backup_bucket_id
}

output "upload_bucket" {
  value = module.s3.upload_bucket_id
}

output "cdn_domain" {
  value = module.cdn.cdn_domain
}
