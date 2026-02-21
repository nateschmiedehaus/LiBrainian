# User Management Service

A simple user management service demonstrating authentication, validation, and database operations.

## Features

- User authentication with JWT tokens
- Email validation
- User CRUD operations
- PostgreSQL database integration

## Getting Started

```bash
npm install
npm start
```

## Architecture

The service is organized into:
- `src/auth/` - Authentication logic
- `src/user/` - User service operations
- `src/utils/` - Shared utilities (validators, date helpers)
- `src/config/` - Configuration management
- `src/db/` - Database client

## Testing

```bash
npm test
```
