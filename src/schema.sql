CREATE TABLE IF NOT EXISTS users (
  id              VARCHAR(36) PRIMARY KEY,
  email           VARCHAR(254) NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name_enc        TEXT NOT NULL,
  cpf_enc         TEXT NOT NULL,
  cpf_index       VARCHAR(254) NOT NULL UNIQUE,
  phone_enc       TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    BIGINT,
  token_version   INTEGER NOT NULL DEFAULT 0,
  created_at      BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS addresses (
  id         VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  data_enc   TEXT NOT NULL,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS cards (
  id          VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  holder_enc  TEXT NOT NULL,
  pan_enc     TEXT NOT NULL,           -- cifrado com CARD_KEY (chave separada)
  last4       TEXT NOT NULL,
  brand       TEXT NOT NULL,
  exp_month   INTEGER NOT NULL,
  exp_year    INTEGER NOT NULL,
  created_at  BIGINT NOT NULL
  -- CVV NUNCA é armazenado (PCI DSS 3.2)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS products (
  id          VARCHAR(36) PRIMARY KEY,
  seller_id VARCHAR(36) NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS orders (
  id             VARCHAR(36) PRIMARY KEY,
  buyer_id VARCHAR(36) NOT NULL,
  FOREIGN KEY (buyer_id) REFERENCES users(id),
  seller_id VARCHAR(36) NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES users(id),
  product_id VARCHAR(36) NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id),
  product_name   TEXT NOT NULL,
  unit_cents     INTEGER NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  shipping_cents INTEGER NOT NULL,
  total_cents    INTEGER NOT NULL,
  address_enc    TEXT NOT NULL,
  card_last4     TEXT NOT NULL,
  card_brand     TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('AGUARDANDO_ENVIO','ENVIADO','ENTREGUE','CANCELADO')),
  tracking_code  TEXT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS password_resets (
  id         VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(254) NOT NULL UNIQUE,     -- só o hash do token é guardado
  expires_at BIGINT NOT NULL,
  used_at    BIGINT,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id    VARCHAR(36),
  event      TEXT NOT NULL,
  ip         TEXT,
  detail     TEXT,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS outbox (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
