-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `password_hash` TEXT NOT NULL,
    `name_enc` TEXT NOT NULL,
    `cpf_enc` TEXT NOT NULL,
    `cpf_index` VARCHAR(254) NOT NULL,
    `phone_enc` TEXT NOT NULL,
    `failed_attempts` INTEGER NOT NULL DEFAULT 0,
    `locked_until` BIGINT NULL,
    `token_version` INTEGER NOT NULL DEFAULT 0,
    `created_at` BIGINT NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_cpf_index_key`(`cpf_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `addresses` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `data_enc` TEXT NOT NULL,
    `created_at` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `cards` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `holder_enc` TEXT NOT NULL,
    `pan_enc` TEXT NOT NULL,
    `last4` TEXT NOT NULL,
    `brand` TEXT NOT NULL,
    `exp_month` INTEGER NOT NULL,
    `exp_year` INTEGER NOT NULL,
    `created_at` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `products` (
    `id` VARCHAR(36) NOT NULL,
    `seller_id` VARCHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `price_cents` INTEGER NOT NULL,
    `stock` INTEGER NOT NULL,
    `active` INTEGER NOT NULL DEFAULT 1,
    `created_at` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `orders` (
    `id` VARCHAR(36) NOT NULL,
    `buyer_id` VARCHAR(36) NOT NULL,
    `seller_id` VARCHAR(36) NOT NULL,
    `product_id` VARCHAR(36) NOT NULL,
    `product_name` TEXT NOT NULL,
    `unit_cents` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `shipping_cents` INTEGER NOT NULL,
    `total_cents` INTEGER NOT NULL,
    `address_enc` TEXT NOT NULL,
    `card_last4` TEXT NOT NULL,
    `card_brand` TEXT NOT NULL,
    `status` TEXT NOT NULL,
    `tracking_code` TEXT NULL,
    `created_at` BIGINT NOT NULL,
    `updated_at` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `password_resets` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `token_hash` VARCHAR(254) NOT NULL,
    `expires_at` BIGINT NOT NULL,
    `used_at` BIGINT NULL,
    `created_at` BIGINT NOT NULL,

    UNIQUE INDEX `password_resets_token_hash_key`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(36) NULL,
    `event` TEXT NOT NULL,
    `ip` TEXT NULL,
    `detail` TEXT NULL,
    `created_at` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `outbox` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `to_email` TEXT NOT NULL,
    `subject` TEXT NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- AddForeignKey
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `cards` ADD CONSTRAINT `cards_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_seller_id_fkey` FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_buyer_id_fkey` FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_seller_id_fkey` FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `password_resets` ADD CONSTRAINT `password_resets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `products`
  ADD CONSTRAINT `products_price_positive` CHECK (`price_cents` > 0),
  ADD CONSTRAINT `products_stock_nonnegative` CHECK (`stock` >= 0);
ALTER TABLE `orders`
  ADD CONSTRAINT `orders_quantity_positive` CHECK (`quantity` > 0),
  ADD CONSTRAINT `orders_status_valid` CHECK (`status` IN ('AGUARDANDO_ENVIO','ENVIADO','ENTREGUE','CANCELADO'));
