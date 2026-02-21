# Security Notes

- auth.require_role rejects roles not in config.ALLOWED_ROLES.
- policy.can_open_ticket blocks guest users from opening tickets.
- Tokens expire after TOKEN_TTL_MINUTES and authenticate rejects expired tokens.
