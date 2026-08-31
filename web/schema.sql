-- QChat web app tables.
--
-- These live in the SAME `qchat` MySQL database that Anope stores its accounts
-- in (Anope creates its own `anope_db_*` tables). We key everything off the
-- services account name (lower-cased for case-insensitive lookups), so there is
-- no fragile foreign key into Anope's version-specific schema.
--
-- Apply with:  mysql -u <user> -p qchat < schema.sql

CREATE TABLE IF NOT EXISTS profiles (
  account_lower VARCHAR(64)  NOT NULL,             -- lookup key (lower-cased account)
  account       VARCHAR(64)  NOT NULL,             -- canonical account name
  display_name  VARCHAR(64)  DEFAULT NULL,
  pronouns      VARCHAR(32)  DEFAULT NULL,
  status        VARCHAR(120) DEFAULT NULL,
  bio           TEXT         DEFAULT NULL,
  links         TEXT         DEFAULT NULL,          -- one URL per line
  avatar        VARCHAR(255) DEFAULT NULL,          -- path under assets/images/avatars
  accent        VARCHAR(9)   DEFAULT NULL,          -- accent colour, e.g. #7c8cff
  profile_html  MEDIUMTEXT   DEFAULT NULL,          -- sanitised custom profile markup
  age           TINYINT UNSIGNED DEFAULT NULL,
  gender        VARCHAR(32)  DEFAULT NULL,
  location      VARCHAR(80)  DEFAULT NULL,
  timezone      VARCHAR(48)  DEFAULT NULL,
  relationship  VARCHAR(32)  DEFAULT NULL,
  looking_for   VARCHAR(120) DEFAULT NULL,
  occupation    VARCHAR(80)  DEFAULT NULL,
  interests     VARCHAR(255) DEFAULT NULL,
  favourites    VARCHAR(255) DEFAULT NULL,
  prefs         TEXT         DEFAULT NULL,           -- JSON: field visibility + allow_pm
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (account_lower)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  account_lower VARCHAR(64) NOT NULL,
  role          VARCHAR(32) NOT NULL,              -- e.g. 'admin'
  PRIMARY KEY (account_lower, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS announcements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  body        VARCHAR(500) NOT NULL,
  by_account  VARCHAR(64)  NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Password-reset tokens (the PHP forgotten-password flow emails one of these).
CREATE TABLE IF NOT EXISTS password_resets (
  token         CHAR(64)     NOT NULL PRIMARY KEY, -- random hex, single use
  account_lower VARCHAR(64)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  expires_at    DATETIME     NOT NULL,
  used          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pr_account (account_lower)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Account directory: our own record of who signed up + their email, so the
-- website can send password-reset links without reading Anope's tables.
CREATE TABLE IF NOT EXISTS accounts (
  account_lower VARCHAR(64)  NOT NULL PRIMARY KEY,
  account       VARCHAR(64)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed the first admin. Change 'russ' if your account name differs.
INSERT IGNORE INTO roles (account_lower, role) VALUES ('russ', 'admin');

-- ---------------------------------------------------------------------------
-- Migration for an EXISTING database (safe to run once; ignore "duplicate
-- column" errors if you have already applied it). phpMyAdmin: paste into SQL.
-- ---------------------------------------------------------------------------
-- ALTER TABLE profiles ADD COLUMN accent VARCHAR(9) DEFAULT NULL AFTER avatar;
-- ALTER TABLE profiles ADD COLUMN profile_html MEDIUMTEXT DEFAULT NULL AFTER accent;
--
-- Extended chat-profile fields + display preferences:
-- ALTER TABLE profiles
--   ADD COLUMN age TINYINT UNSIGNED DEFAULT NULL,
--   ADD COLUMN gender VARCHAR(32) DEFAULT NULL,
--   ADD COLUMN location VARCHAR(80) DEFAULT NULL,
--   ADD COLUMN timezone VARCHAR(48) DEFAULT NULL,
--   ADD COLUMN relationship VARCHAR(32) DEFAULT NULL,
--   ADD COLUMN looking_for VARCHAR(120) DEFAULT NULL,
--   ADD COLUMN occupation VARCHAR(80) DEFAULT NULL,
--   ADD COLUMN interests VARCHAR(255) DEFAULT NULL,
--   ADD COLUMN favourites VARCHAR(255) DEFAULT NULL,
--   ADD COLUMN prefs TEXT DEFAULT NULL;
