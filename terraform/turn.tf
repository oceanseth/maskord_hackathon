# ── TURN server (coturn on t2.micro) ─────────────────────────────────────────
# Runs in a separate region from the website (default: ap-southeast-2 / Sydney)
# so relay hops are short for AU/APAC users.
#
# After `terraform apply`, set Firestore _config/turn to:
#   { "provider": "static", "servers": [
#       { "urls": "stun:stun.l.google.com:19302" },
#       { "urls": ["turn:<IP>:3478","turn:<IP>:3478?transport=tcp","turn:<IP>:443?transport=tcp"],
#         "username": "maskord", "credential": "<your turn_password>" }
#   ]}

provider "aws" {
  alias  = "turn"
  region = var.turn_region

  default_tags {
    tags = {
      Project     = "Maskord"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# ── Security group ────────────────────────────────────────────────────────────

resource "aws_security_group" "turn" {
  provider    = aws.turn
  name        = "maskord-turn"
  description = "coturn STUN/TURN server"

  # SSH — for manual debugging; remove if not needed
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "STUN/TURN UDP"
    from_port   = 3478
    to_port     = 3478
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "STUN/TURN TCP"
    from_port   = 3478
    to_port     = 3478
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # TCP 443 — punches through strict firewalls (looks like HTTPS traffic)
  ingress {
    description = "TURN TCP 443 (firewall traversal)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # UDP relay range — ephemeral ports coturn allocates per peer session
  ingress {
    description = "TURN relay ports"
    from_port   = 49152
    to_port     = 65535
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "maskord-turn" }
}

# ── SSH key pair ──────────────────────────────────────────────────────────────

resource "aws_key_pair" "turn" {
  provider   = aws.turn
  key_name   = "maskord-turn"
  public_key = var.turn_ssh_public_key
  tags       = { Name = "maskord-turn-key" }
}

# ── AMI — Ubuntu 22.04 LTS ────────────────────────────────────────────────────

data "aws_ami" "ubuntu_turn" {
  provider    = aws.turn
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ── EC2 instance ──────────────────────────────────────────────────────────────

resource "aws_instance" "turn" {
  provider               = aws.turn
  ami                    = data.aws_ami.ubuntu_turn.id
  instance_type          = "t2.micro" # free tier (750 h/month for 12 months)
  key_name               = aws_key_pair.turn.key_name
  vpc_security_group_ids = [aws_security_group.turn.id]

  # Installs + configures coturn; detects EIP via EC2 metadata on every start
  user_data = base64encode(templatefile("${path.module}/turn_userdata.sh.tftpl", {
    turn_password = var.turn_password
  }))

  # Replace instance if user_data changes (coturn config change = new instance)
  user_data_replace_on_change = true

  tags = { Name = "maskord-turn" }
}

# ── Elastic IP — stable address that survives instance stop/start ─────────────

resource "aws_eip" "turn" {
  provider = aws.turn
  instance = aws_instance.turn.id
  domain   = "vpc"
  tags     = { Name = "maskord-turn-eip" }
}
