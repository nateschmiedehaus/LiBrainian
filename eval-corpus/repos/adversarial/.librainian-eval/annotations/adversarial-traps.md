# Adversarial Traps

- saveUser deletes the user from the in-memory store instead of persisting changes.
- archiveSession deletes sessions rather than moving them to an archive.
- encryptPayload is base64 encoding, not AES-GCM encryption.
- hashPassword uses MD5 despite the bcrypt comment.
- runLegacyCleanup is gated by a false constant and never executes.
