-- Instructor email recovery storage (MySQL / MariaDB).
-- Back up the database and select the correct database before running.
-- Run once: check that these columns, index, and table do not already exist.
-- Apply this storage migration before deploying the instructor recovery feature.
-- Configure the email sender and login URL as documented in api/README.md.

ALTER TABLE instructor_accounts
  ADD COLUMN email VARCHAR(254) DEFAULT NULL,
  ADD COLUMN email_verified_at DATETIME DEFAULT NULL,
  ADD UNIQUE KEY uq_instructor_email (email);

CREATE TABLE instructor_password_resets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  instructor_uid VARCHAR(80) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reset_token_hash (token_hash),
  KEY idx_reset_instructor (instructor_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Store only the reset token's SHA-256 hash in token_hash, never the raw token.
-- New passwords must be hashed and stored in instructor_accounts.password.

-- Student's reason for requesting a record edit.
-- Existing requests remain NULL; application code must save and display the reason.
-- Run once after checking that request_reason does not already exist.
ALTER TABLE edit_requests
  ADD COLUMN request_reason TEXT DEFAULT NULL;
